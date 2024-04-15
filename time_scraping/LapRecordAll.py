from selenium import webdriver
import time
from selenium.webdriver.common.by import By
from urllib.parse import quote
import pandas as pd
import openpyxl
from openpyxl.utils.dataframe import dataframe_to_rows 

# オプション設定とブラウザの起動
chrome_options = webdriver.ChromeOptions()
chrome_options.add_experimental_option('excludeSwitches', ['enable-logging'])
driver = webdriver.Chrome(options=chrome_options)

# 指定URLにアクセス
base_url = "http://racenow-motegi-1.racelive.jp/pages/live.html"
driver.get(base_url)

time.sleep(3)  # ページが完全に読み込まれるまで待機

# 個別ページのURLを取得
monitor_list = driver.execute_script("return monitorList;")
roundtype = driver.execute_script("return roundtype;")

links = []
for row in monitor_list:
    car_no = row["ID"]
    team_name = quote(row["TeamName"])
    race_class = row["ClassName"]

    url = f"http://racenow-motegi-1.racelive.jp/pages/gap.html?carno={car_no}&team={team_name}&mode={roundtype}&raceclass={race_class}"
    links.append(url)

# Excelファイルを作成
workbook = openpyxl.Workbook()
dfs = {}

# 各選手のデータを取得してDataframeに格納
for link in links:
    driver.get(link)
    time.sleep(3)
    element = driver.find_element(By.XPATH, '//*[@id="GapListArea"]/table')
    tdlist = element.find_elements(By.TAG_NAME, 'td')

    # 空白を削除
    data = [elem.text for elem in tdlist if elem.text != '']

     # 最初のデータセグメントが不完全かどうかを確認
    remainder = len(data) % 8
    if remainder != 0 and len(data) > remainder:  # 最初のセグメントが不完全であれば
        data = data[:remainder] + [''] * (8 - remainder) + data[remainder:]

    if len(data) <= 2:  # データが2以下であればスキップ
        continue

    # データを分割してDataFrameに変換
    formatted_data = []
    for i in range(0, len(data), 8):
        segment = data[i:i+8]
        # 不足分を空欄で補う
        while len(segment) < 8:
            segment.append('')
        formatted_data.append(segment)

    df = pd.DataFrame(formatted_data, columns=['lap', 'name', 'sec1', 'sec2', 'sec3', 'speed', 'sec4', 'record'])
    name = df['Name'].iloc[0]
    if name not in dfs:
        dfs[name] = df
    else:
        dfs[name] = pd.concat([dfs[name], df])
    
    print(name+"完了")

# 各DataFrameをExcelシートに保存
for name, df in dfs.items():
    name = name.replace("/", "-")
    ws = workbook.create_sheet(title=name[:30])  # Excelシート名の長さ制限
    for r in dataframe_to_rows(df, index=False, header=True):
        ws.append(r)

workbook.save('gap.xlsx')
driver.quit()
