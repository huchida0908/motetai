from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
from selenium.webdriver.common.by import By
from urllib.parse import quote
import pandas as pd
import openpyxl
from openpyxl.utils.dataframe import dataframe_to_rows 

start_time = time.time()

# オプション設定とブラウザの起動
chrome_options = webdriver.ChromeOptions()
chrome_options.add_experimental_option('excludeSwitches', ['enable-logging'])
driver = webdriver.Chrome(options=chrome_options)
wait_time=3

# 指定URLにアクセス
base_url = "http://racenow-motegi-1.racelive.jp/pages/live.html"
driver.get(base_url)

time.sleep(wait_time)  # ページが完全に読み込まれるまで待機

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
for link in links[:5]:
    driver.get(link)
    time.sleep(wait_time)
    element = driver.find_element(By.XPATH, '//*[@id="GapListArea"]/table')
    tdlist = element.find_elements(By.TAG_NAME, 'td')

    # 空白を削除
    data = [elem.text for elem in tdlist]

    f_data = []
    for i in range(len(data), 0, -17):
        segment = data[i-17:i]
        # 最後の8個のデータを削除
        f_data = segment[:-8] + f_data

    if len(f_data) <= 1:
        continue
    print(f_data)

    # データを分割してDataFrameに変換
    formatted_data = []
    for i in range(0, len(f_data), 9):
        segment = f_data[i:i+9]
        # 不足分を空欄で補う
        while len(segment) < 9:
            segment.append('')
        formatted_data.append(segment)

    df = pd.DataFrame(formatted_data, columns=['lap', 'name', 'sec1', 'sec2', 'sec3', 'speed', 'sec4', 'record','pit'])
    print(df)
    name = df['name'].iloc[0]
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

end_time = time.time()
# 処理にかかった時間(秒)を計算
elapsed_time = end_time - start_time
# 処理にかかった時間を表示
print(f"処理にかかった時間: {elapsed_time:.2f}秒")