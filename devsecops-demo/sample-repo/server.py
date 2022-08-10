from flask import Flask, request

app = Flask(__name__)
port = 8080

@app.route("/")
def index():
    return "Congratulations, it's a web app!"


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=port)