from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
from selenium.webdriver.common.by import By
from urllib.parse import quote
import pandas as pd
import openpyxl
from openpyxl.utils.dataframe import dataframe_to_rows
import threading
import concurrent.futures

wait_time=3
# 各リンクの処理を行う関数
def process_link(link):    
    # 各スレッドで独立したWebDriverインスタンスを作成
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_experimental_option('excludeSwitches', ['enable-logging'])
    driver = webdriver.Chrome(options=chrome_options)

    driver.get(link)
    time.sleep(wait_time)
    element = driver.find_element(By.XPATH, '//*[@id="GapListArea"]/table')
    tdlist = element.find_elements(By.TAG_NAME, 'td')
    data = [elem.text for elem in tdlist]
    f_data = []
    for i in range(len(data), 0, -17):
        segment = data[i-17:i]
        f_data = segment[:-8] + f_data
    if len(f_data) <= 1:
        driver.quit()
        return
    formatted_data = []
    for i in range(0, len(f_data), 9):
        segment = f_data[i:i+9]
        while len(segment) < 9:
            segment.append('')
        formatted_data.append(segment)
    df = pd.DataFrame(formatted_data, columns=['lap', 'name', 'sec1', 'sec2', 'sec3', 'speed', 'sec4', 'record', 'pit'])
    print(df)
    name = df['name'].iloc[0]
    dfs[name] = pd.concat([dfs.get(name, pd.DataFrame()), df])
    print(f"{name} 完了")

    # WebDriverインスタンスを閉じる
    driver.quit()

# マルチスレッドで並列処理を行う関数
def run_parallel():
    threads = []
    for link in links[:5]:
        thread = threading.Thread(target=process_link, args=(link,))
        threads.append(thread)
        thread.start()

    for thread in threads:
        thread.join()

start_time = time.time()

# 指定URLにアクセス
base_url = "http://racenow-motegi-1.racelive.jp/pages/live.html"
driver = webdriver.Chrome()  # ベースURLを開くためのWebDriverインスタンス
driver.get(base_url)
time.sleep(wait_time)

# 個別ページのURLを取得
monitor_list = driver.execute_script("return monitorList;")
roundtype = driver.execute_script("return roundtype;")
links = []
for row in monitor_list:
    if row["Pos"] != '  ':
        car_no = row["ID"]
        team_name = quote(row["TeamName"])
        race_class = row["ClassName"]
        url = f"http://racenow-motegi-1.racelive.jp/pages/gap.html?carno={car_no}&team={team_name}&mode={roundtype}&raceclass={race_class}"
        links.append(url)

#print(links)

driver.quit()  # ベースURLを開いたWebDriverインスタンスを閉じる
print(len(links))

# Excelファイルを作成
workbook = openpyxl.Workbook()
dfs = {}

# 並列処理を実行
#run_parallel()

# ThreadPoolExecutorを使用して並列処理を実行
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
    executor.map(process_link, links)

# 各DataFrameをExcelシートに保存
for name, df in dfs.items():
    name = name.replace("/", "-")
    ws = workbook.create_sheet(title=name[:30])  # Excelシート名の長さ制限
    for r in dataframe_to_rows(df, index=False, header=True):
        ws.append(r)

workbook.save('gap.xlsx')

end_time = time.time()
elapsed_time = end_time - start_time
print(f"処理にかかった時間: {elapsed_time:.2f}秒")