import math
import random as rand

def roletaeuropeia():
    num = rand.randint(0,36)

    red = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]
    black = [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]

    if num in black:
        color = "black"
    elif num in red:
        color = "red"
    else:
        color = "green"

    return num, color

def crashout():
    houseedge = 0.2

    if rand.random() < houseedge:
        return round(rand.uniform(0, 1),3)
    
    ligma = round(rand.random(),2)
    mult = 1 / (1 - ligma)

    maxmult = 100
    if mult > maxmult:
        mult = maxmult

    return round(mult, 2)

def crash_multiplier_to_time(multiplier, growth_rate=0.06):
    """Converts a target crash multiplier to the total elapsed time in seconds.

    Args:
        multiplier (float): The crash multiplier (e.g., 0.50, 1.00, 2.50).
        growth_rate (float): Controls speed acceleration. Standard default is ~0.06.

    Returns:
        float: Duration in seconds from start (0.0s) to the crash point.
    """
    # If the crash is <= 0.0x, it crashes instantly at t = 0.0s
    if multiplier <= 0.0:
        return 0.0

    # For multipliers under 1.0x, time scales linearly in a fraction of a second
    if multiplier < 1.0:
        # e.g., 0.5x crashes halfway through the 1-second mark
        return round(multiplier * 0.5, 3)

    # Exponential elapsed time calculation for multipliers >= 1.0x
    seconds = math.log(multiplier) / growth_rate
    return round(seconds, 3)