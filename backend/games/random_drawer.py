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
        return round(rand.uniform(0, 1),2)
    
    ligma = rand.random()
    mult = 1 / (1 - ligma)

    maxmult = 100
    if mult > maxmult:
        mult = maxmult

    return round(mult, 2)