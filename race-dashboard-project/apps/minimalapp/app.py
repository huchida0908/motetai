from flask import Flask

# Flaskインスタンスの作成
app = Flask(__name__)

# URLと実行する関数の紐付け
@app.route('/')
def hello():
    return 'Hello World!!'
