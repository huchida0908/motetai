from flask import Flask, render_template, request
import psycopg2
import pandas as pd
import config

print(__name__)
app = Flask(__name__)

# PostgreSQLへの接続
conn = psycopg2.connect(
    user=config.DB_USER,        #ユーザ
    password=config.PASSWORD,  #パスワード
    host=config.HOST,       #ホスト名
    port=config.PORT,            #ポート
    dbname=config.DATABASE)    #データベース名
    
@app.route('/')
def get_version():
    cur = conn.cursor()
    cur.execute('SELECT version()')
    version = cur.fetchone()[0]
    return f'PostgreSQL version: {version}'

# POSTリクエストを受け取る関数
@app.route('/', methods=['POST'])
def post():
    message = request.form.get('message')
    return 'Message: ' + message

@app.route('/result', methods=["GET"])
def result():
# GET送信の処理
    # manufacturing_factory_id = request.args.get("manufacturing_factory_id","")
    # print(manufacturing_factory_id)

    # sql = "select * from payment where customer_id='{}'"..format(user_id)
    sql = "select * from dev.t_laps order by laps desc limit 1"
    df = pd.read_sql(sql, conn) 

    return render_template('result.html', table=(df.to_html(classes="mystyle")))


if __name__ == "__main__":
    app.run()