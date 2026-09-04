"""
PET Cassino - aplicacao Flask
Serve o Painel TV (dashboard) e o jogo Double (roleta).

- Nome do TABLET/dispositivo: continua guardado no localStorage do navegador
  (feito em static/js/roleta.js), exatamente como antes - e' por isso que so'
  precisa ser configurado uma vez por aparelho.
- Nome do JOGADOR: agora e' pedido por esta aplicacao e guardado na sessao do
  Flask, entao dura so' enquanto aquele navegador estiver com a sessao aberta
  (ate fechar o navegador ou clicar em "Sair").
"""
import os
import secrets

from flask import Flask, render_template, request, redirect, url_for, session

app = Flask(__name__)

# Em producao, defina a variavel de ambiente SECRET_KEY com um valor fixo e
# aleatorio, senao toda vez que a aplicacao reiniciar as sessoes (nomes dos
# jogadores) se perdem e todo mundo precisa digitar o nome de novo.
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))

# Cookie de sessao "nao permanente": o navegador descarta quando fecha.
app.config["SESSION_PERMANENT"] = False


@app.context_processor
def inject_username():
    """Deixa `username` disponivel em qualquer template automaticamente."""
    return {"username": session.get("username")}


@app.route("/")
def painel():
    """Painel TV: estatisticas globais, publico, sem necessidade de nome."""
    return render_template("painel.html", active_page="painel")


@app.route("/roleta")
def roleta():
    """Mesa do Double. Exige nome de jogador definido (sessao)."""
    if "username" not in session:
        return redirect(url_for("entrar", next=url_for("roleta")))
    return render_template("roleta.html", active_page="roleta")


@app.route("/entrar", methods=["GET", "POST"])
def entrar():
    """Pede o nome do jogador e guarda na sessao (nao em banco de dados)."""
    next_url = request.values.get("next") or url_for("roleta")

    if request.method == "POST":
        nome = (request.form.get("nome") or "").strip()[:40]
        if nome:
            session["username"] = nome
            return redirect(next_url)
        return render_template(
            "entrar.html", next=next_url, erro="Digite um nome para continuar."
        )

    # Ja tem nome na sessao? Nao precisa perguntar de novo.
    if "username" in session:
        return redirect(next_url)

    return render_template("entrar.html", next=next_url, erro=None)


@app.route("/sair")
def sair():
    """Botao 'Sair': limpa o nome da sessao (o dispositivo continua salvo)."""
    session.pop("username", None)
    return redirect(url_for("entrar"))


if __name__ == "__main__":
    # host 0.0.0.0 para os outros tablets da rede local conseguirem acessar.
    # debug=False de proposito: com host 0.0.0.0 o debugger interativo do
    # Flask ficaria exposto pra rede inteira, o que nao e' seguro.
    app.run(host="0.0.0.0", port=5000, debug=False)
