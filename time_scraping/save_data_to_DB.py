import openpyxl
import pandas as pd
import os
from sqlalchemy import create_engine
from sqlalchemy import text


# envファイルを読み込む
from dotenv import load_dotenv
load_dotenv()

def convert_time_to_seconds(time_str):
    if time_str is None:
        return None

    # データに文字が含まれている場合、空白に変換
    if not time_str.replace(".", "").isdigit():
        return None

    # ":"が存在するかチェック
    if ":" in time_str:
        # 分と秒に分割
        minutes, seconds = time_str.split(":")
        # 分を秒に変換し、秒と合計
        total_seconds = int(minutes) * 60 + float(seconds)
    else:
        # 分がない場合、時間は秒のみ
        total_seconds = float(time_str)

    return total_seconds

# xlsxファイルを読み込む
workbook = openpyxl.load_workbook('gap.xlsx')
sheet_names = workbook.sheetnames
dfs = {}

# ExcelシートをDataFrameに変換
for sheet_name in sheet_names:
    ws = workbook[sheet_name]
    data = ws.values

    # シートが空であればスキップ
    if not any(data):
        continue

    cols = ["Lap", "Name","Sec1","Sec2","Sec3","Speed","Sec4","Record"]

    # DataFrameに変換
    df = pd.DataFrame(data)
    df.columns = cols
    dfs[sheet_name] = df
    
# dfsを一つのDataFrameに結合
df = pd.concat(dfs.values())

# 重複データを削除
df = df.drop_duplicates()

# indexをリセット
df = df.reset_index(drop=True)

# タイムを秒に変換
df["Sec1"] = df["Sec1"].apply(convert_time_to_seconds)
df["Sec2"] = df["Sec2"].apply(convert_time_to_seconds)
df["Sec3"] = df["Sec3"].apply(convert_time_to_seconds)
df["Sec4"] = df["Sec4"].apply(convert_time_to_seconds)

# レコードタイムはsec1, sec2, sec3, sec4の合計
df["Record"] = df["Sec1"] + df["Sec2"] + df["Sec3"] + df["Sec4"]

# データを表示
# print(df["Sec1"].unique())
print(df)

# supabaseにsqlalchemyで接続
password = os.getenv("SUPABASE_PASSWORD")
host = os.getenv("SUPABASE_HOST")
user = os.getenv("SUPABASE_USER")
connection_string = f"postgresql+psycopg2://{user}:{password}@{host}:5432/postgres"
engine = create_engine(connection_string, echo=True)

# DBのバージョンを確認
with engine.connect() as connection:
    result = connection.execute(text("SELECT version()"))
    print(result.fetchone())



# DataFrameをDBに保存
df.to_sql(name="laps", con=engine, if_exists='replace', index=False)

