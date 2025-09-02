const axios = require('axios');
const { createClient } = require('redis');
const { SUPPORTED_SYMBOLS } = require('./constants'); //

const redisClient = createClient({ url: process.env.REDIS_URL });

const TIME_FRAMES = ['5m', '15m', '30m', '1h', '4h', '1d'];
const KLINE_LIMIT = 100; // Son 100 mum verisi analiz için yeterlidir.

// ATR Hesaplama Fonksiyonu
function calculateATR(klines, period = 14) {
    let tr_sum = 0;
    for (let i = 1; i < klines.length; i++) {
        const high = parseFloat(klines[i][2]);
        const low = parseFloat(klines[i][3]);
        const prev_close = parseFloat(klines[i - 1][4]);
        const tr = Math.max(high - low, Math.abs(high - prev_close), Math.abs(low - prev_close));
        tr_sum += tr;
    }
    return tr_sum / period;
}

// Swing High/Low Bulma
function findSwingPoints(klines) {
    let swingHigh = 0;
    let swingLow = Infinity;
    klines.forEach(k => {
        const high = parseFloat(k[2]);
        const low = parseFloat(k[3]);
        if (high > swingHigh) swingHigh = high;
        if (low < swingLow) swingLow = low;
    });
    return { swingHigh, swingLow };
}


async function updateAnalysisData() {
    console.log('[AnalysisService] Updating market structure data...');
    for (const symbol of SUPPORTED_SYMBOLS) {
        for (const frame of TIME_FRAMES) {
            try {
                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${frame}&limit=${KLINE_LIMIT}`;
                const { data: klines } = await axios.get(url);

                const atr = calculateATR(klines);
                const { swingHigh, swingLow } = findSwingPoints(klines.slice(-20)); // Son 20 mumdaki tepe/dip

                const analysis = {
                    atr: atr.toFixed(5),
                    swingHigh: swingHigh.toFixed(5),
                    swingLow: swingLow.toFixed(5),
                    updatedAt: new Date().toISOString()
                };

                const redisKey = `analysis:${symbol}:${frame}`;
                await redisClient.set(redisKey, JSON.stringify(analysis), { EX: 3600 }); // 1 saat geçerli

            } catch (error) {
                console.error(`[AnalysisService] Failed for ${symbol}-${frame}:`, error.message);
            }
        }
    }
    console.log('[AnalysisService] Update complete.');
}

async function startAnalysisService() {
    await redisClient.connect();
    console.log('[AnalysisService] Connected to Redis.');
    setInterval(updateAnalysisData, 60 * 10000); // Her 1 dakikada bir çalýþtýr
    await updateAnalysisData(); // Baþlangýçta hemen çalýþtýr
}

module.exports = { startAnalysisService };