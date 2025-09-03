# -*- coding: utf-8 -*-
import logging
from decimal import Decimal, getcontext
from typing import Dict, Optional

# Local application imports
from database.models import PositionDirection

# Set a high precision for all Decimal calculations in this module
getcontext().prec = 50

def calculate_percentage_based_prices(
    entry_price: Decimal,
    direction: PositionDirection,
    leverage: int,
    tp1_percentage: float,
    sl_percentage: float,
    tp2_percentage: Optional[float] = None
) -> Dict[str, Decimal]:
    """
    Calculates TP1, SL, and TP2 prices based on given percentages and leverage.
    If tp2_percentage is not provided, it defaults to double the tp1_percentage.
    
    Returns a dictionary with 'tp1_price', 'sl_price', and 'tp2_price'.
    """
    if leverage <= 0:
        raise ValueError("Leverage must be a positive number.")

    # --- Convert input percentages to high-precision Decimal factors ---
    tp1_decimal_factor = Decimal(str(tp1_percentage)) / Decimal('100')
    sl_decimal_factor = Decimal(str(sl_percentage)) / Decimal('100')

    # Determine TP2 factor: use the provided value or default to 2 * TP1
    if tp2_percentage and tp2_percentage > 0:
        tp2_decimal_factor = Decimal(str(tp2_percentage)) / Decimal('100')
    else:
        tp2_decimal_factor = tp1_decimal_factor * Decimal('2')

    # --- Calculate how much the price needs to change for each target ---
    price_change_factor_tp1 = tp1_decimal_factor / Decimal(str(leverage))
    price_change_factor_sl = sl_decimal_factor / Decimal(str(leverage))
    price_change_factor_tp2 = tp2_decimal_factor / Decimal(str(leverage))

    # --- Calculate the actual price change amount in USDT ---
    price_change_tp1 = entry_price * price_change_factor_tp1
    price_change_sl = entry_price * price_change_factor_sl
    price_change_tp2 = entry_price * price_change_factor_tp2

    # --- Determine final prices based on the position's direction ---
    if direction == PositionDirection.LONG:
        tp1_price = entry_price + price_change_tp1
        sl_price = entry_price - price_change_sl
        tp2_price = entry_price + price_change_tp2
    elif direction == PositionDirection.SHORT:
        tp1_price = entry_price - price_change_tp1
        sl_price = entry_price + price_change_sl
        tp2_price = entry_price - price_change_tp2
    else:
        raise ValueError(f"Invalid position direction provided: {direction}")

    # Ensure final prices are not negative
    return {
        "tp1_price": max(tp1_price, Decimal('0')),
        "sl_price": max(sl_price, Decimal('0')),
        "tp2_price": max(tp2_price, Decimal('0'))
    }

def calculate_position_size_usdt(risk_amount: Decimal, leverage: int) -> Decimal:
    """
    Calculates the total USDT value of the position.
    Formula: Position Value = Margin (Risk Amount) * Leverage.
    """
    if leverage <= 0:
        raise ValueError("Leverage must be a positive number.")
    if risk_amount < 0:
        raise ValueError("Risk amount cannot be negative.")
    return risk_amount * Decimal(str(leverage))

def calculate_quantity_from_usdt(position_size_usdt: Decimal, price: Decimal) -> Decimal:
    """
    Calculates the coin quantity to be traded based on the position's value in USDT.
    Formula: Quantity = Total Position Value / Current Price.
    """
    if price <= 0:
        raise ValueError("Price must be greater than zero for quantity calculation.")
    return position_size_usdt / price

def calculate_atr_swing_prices(
    entry_price: Decimal,
    direction: PositionDirection,
    analysis_data: dict,
    atr_multiplier_sl: Decimal = Decimal('1.5'),
    atr_multiplier_tp: Decimal = Decimal('2.0')
) -> Dict[str, Decimal]:
    """
    Calculates TP/SL prices based on ATR and recent swing points.
    """
    try:
        atr = Decimal(analysis_data['atr'])
        swing_high = Decimal(analysis_data['swingHigh'])
        swing_low = Decimal(analysis_data['swingLow'])
    except (KeyError, TypeError) as e:
        logging.error(f"Analysis data is invalid or missing required keys: {e}")
        return {"tp_price": Decimal('0'), "sl_price": Decimal('0')}

    if direction == PositionDirection.LONG:
        sl_price = swing_low - (atr * atr_multiplier_sl)
        tp_price = entry_price + (atr * atr_multiplier_tp)
    elif direction == PositionDirection.SHORT:
        sl_price = swing_high + (atr * atr_multiplier_sl)
        tp_price = entry_price - (atr * atr_multiplier_tp)
    else:
        return {"tp_price": Decimal('0'), "sl_price": Decimal('0')}
    
    # Ensure final prices are not negative
    return {
        "tp_price": max(tp_price, Decimal('0')),
        "sl_price": max(sl_price, Decimal('0'))
    }