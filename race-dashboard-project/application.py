from flask import Flask, render_template, request
import psycopg2
import pandas as pd

print(__name__)
app = Flask(__name__)

# PostgreSQLへの接続
conn = psycopg2.connect(
    user="cips_root",        #ユーザ
    password="MI6-fallout!",  #パスワード
    host="fdx-v2.postgres.database.azure.com",       #ホスト名
    port="5432",            #ポート
    dbname="postgres")    #データベース名
    
@app.route('/')
def get_version():
    cur = conn.cursor()
    cur.execute('SELECT version()')
    version = cur.fetchone()[0]
    return f'PostgreSQL version: {version}'

@app.route('/result', methods=["GET"])
def result():
# GET送信の処理
    manufacturing_factory_id = request.args.get("manufacturing_factory_id","")
    print(manufacturing_factory_id)

    # sql = "select * from payment where customer_id='{}'"..format(user_id)
    sql = "select * from factory.daily_production_plan where manufacturing_factory_id='{}'".format(manufacturing_factory_id)
    df = pd.read_sql(sql, conn) 

    return render_template('result.html', table=(df.to_html(classes="mystyle")))


if __name__ == "__main__":
    app.run()