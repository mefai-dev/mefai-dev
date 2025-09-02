const express = require('express');
const router = express.Router();
const Binance = require('binance-api-node').default;
const { decrypt } = require('../utils/cipher');

// --- Helper Functions ---

/**
 * Converts a value to a number, returning 0 if invalid.
 * @param {string | number} n The value to convert.
 * @returns {number} The parsed number or 0.
 */
const toNum = (n) => {
    const x = parseFloat(n);
    return Number.isFinite(x) ? x : 0;
};

/**
 * Formats a number to a fixed number of decimal places.
 * @param {string | number} n The number to format.
 * @param {number} [decimals=2] The number of decimal places.
 * @returns {string} The formatted string representation of the number.
 */
const toFixed = (n, decimals = 2) => {
    const x = parseFloat(n);
    return Number.isFinite(x) ? x.toFixed(decimals) : '0.00';
};

/**
 * Computes the initial margin for a position.
 * @param {string} positionAmt The amount of the position.
 * @param {string} entryPrice The entry price.
 * @param {string} leverage The leverage.
 * @returns {number} The computed initial margin.
 */
const computeMargin = (positionAmt, entryPrice, leverage) => {
    const qty = Math.abs(toNum(positionAmt));
    const price = toNum(entryPrice);
    const lev = toNum(leverage);
    if (qty <= 0 || price <= 0 || lev <= 0) return 0;
    return (qty * price) / lev;
};

/**
 * Calculates the Return on Equity (ROE) for a position.
 * @returns {number} The ROE in percentage.
 */
const calcRoe = (unRealizedProfit, initialMargin, positionAmt, entryPrice, leverage) => {
    const upnl = toNum(unRealizedProfit);
    const margin = toNum(initialMargin) || computeMargin(positionAmt, entryPrice, leverage);
    return margin !== 0 ? (upnl / margin) * 100 : 0;
};

/**
 * Initializes a Binance client instance for a given user.
 * @param {object} pool The PostgreSQL connection pool.
 * @param {number} userId The user's ID.
 * @returns {Promise<object|null>} A Binance client instance or null if keys are invalid.
 */
const initBinanceClient = async (pool, userId) => {
    const query = 'SELECT binance_api_key_encrypted, binance_secret_key_encrypted FROM user_settings WHERE user_id = $1';
    const { rows } = await pool.query(query, [userId]);
    if (!rows[0]?.binance_api_key_encrypted) {
        return null;
    }
    const apiKey = decrypt(rows[0].binance_api_key_encrypted);
    const apiSecret = decrypt(rows[0].binance_secret_key_encrypted);
    if (!apiKey || !apiSecret) {
        return null;
    }
    return Binance({ apiKey, apiSecret, futures: true });
};


module.exports = (pool) => {
    /**
     * GET /api/account/info
     * Fetches the user's futures account balance and all open positions.
     * Positions are enriched with calculated ROI and linked TP/SL order prices.
     */
    router.get('/info', async (req, res) => {
        const userId = req.user.userId;
        try {
            const client = await initBinanceClient(pool, userId);
            if (!client) {
                return res.status(403).json({ error: 'API keys are not configured or are invalid.' });
            }

            // Fetch account data, positions, and open orders concurrently for speed
            const [accountInfo, positionRisk, openOrders] = await Promise.all([
                client.futuresAccountInfo(),
                client.futuresPositionRisk(),
                client.futuresOpenOrders(),
            ]);

            // Extract USDT balance information
            const usdtAsset = (accountInfo.assets || []).find(a => a.asset === 'USDT');
            const totalBalance = usdtAsset ? toFixed(usdtAsset.walletBalance) : '0.00';
            const availableBalance = usdtAsset ? toFixed(usdtAsset.availableBalance) : '0.00';

            // Filter for positions with a non-zero amount
            const openPositions = (positionRisk || []).filter(p => toNum(p.positionAmt) !== 0);

            // Optimize TP/SL lookup by grouping open orders by symbol
            const ordersBySymbol = openOrders.reduce((acc, order) => {
                if (!acc[order.symbol]) acc[order.symbol] = [];
                acc[order.symbol].push(order);
                return acc;
            }, {});

            const enrichedPositions = openPositions.map(p => {
                const initialMargin = toNum(p.initialMargin) || computeMargin(p.positionAmt, p.entryPrice, p.leverage);

                // Find associated TP/SL orders from the optimized map
                const symbolOrders = ordersBySymbol[p.symbol] || [];
                const tpOrder = symbolOrders.find(o => o.positionSide === p.positionSide && o.type === 'TAKE_PROFIT_MARKET');
                const slOrder = symbolOrders.find(o => o.positionSide === p.positionSide && o.type === 'STOP_MARKET');

                return {
                    symbol: p.symbol,
                    positionAmt: p.positionAmt,
                    positionSide: p.positionSide,
                    leverage: p.leverage,
                    entryPrice: toNum(p.entryPrice),
                    markPrice: toNum(p.markPrice),
                    liquidationPrice: toNum(p.liquidationPrice),
                    initialMargin: toFixed(initialMargin),
                    unRealizedProfit: toFixed(p.unRealizedProfit),
                    roe: calcRoe(p.unRealizedProfit, initialMargin, p.positionAmt, p.entryPrice, p.leverage),
                    takeProfitPrice: tpOrder ? tpOrder.stopPrice : null,
                    stopLossPrice: slOrder ? slOrder.stopPrice : null,
                };
            });

            res.status(200).json({
                totalBalance: totalBalance,
                availableBalance: availableBalance,
                positions: enrichedPositions
            });

        } catch (error) {
            console.error(`[User:${userId}] Failed to fetch account info:`, error.message);
            // Provide a more specific error if API keys are invalid
            if (error.code === -1022 || error.code === -2015) {
                return res.status(401).json({ error: 'Authentication error. Please check your API keys.' });
            }
            res.status(500).json({ error: 'An error occurred while fetching account information from Binance.' });
        }
    });

    return router;
};