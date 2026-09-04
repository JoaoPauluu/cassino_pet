import random as rand

def roletaeuropeia():
    num = rand.randint(0,12)

    red = {x: x % 2 == 1 for x in range(1,12)}
    black = {x: x % 2 == 0 for x in range(1,12)}

    if num in black:
        color = "black"
    elif num in red:
        color = "red"
    else:
        color = "green"



    # return {                  # SISTEMA DE CORES DEVE SER IMPLEMENTADO PELO FRONTEND!
    #     'Resultado': num,
    #     'Cor': color
    # }

    return num

def crashout():
    houseedge = 0.2

    if rand.random() < houseedge:
        return round(rand.uniform(0, houseedge),2)
    
    ligma = rand.random()
    mult = 1 / (1 - ligma)

    maxmult = 20
    if mult > maxmult:
        mult = maxmult

    return round(mult, 2)