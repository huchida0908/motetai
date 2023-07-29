from selenium import webdriver
#import chromedriver_binary  # chromedriver-binaryの場合これも必要
import time
from selenium.webdriver.common.by import By

url = "http://racenow-motegi-1.racelive.jp/pages/gap.html?carno=152&team=%EF%BE%8F%EF%BE%84%EF%BE%9E%EF%BD%B6%E8%A8%AD%E8%A8%88%26amp%3BSP-3%26amp%3B%EF%BD%B1%EF%BE%9D%EF%BE%8C%EF%BD%A8%EF%BE%86&mode=L&raceclass=WT"

#-------------------------------エラーメッセージを消す-------------------------------
ChromeOptions = webdriver.ChromeOptions()
ChromeOptions.add_experimental_option('excludeSwitches', ['enable-logging'])
#----------------------------------------------------------------------------------

# 指定したページを開く
driver = webdriver.Chrome(options=ChromeOptions)
driver.get(url)

# ページが開くまで待機
time.sleep(3)

# 対象のテーブルを取得
element = driver.find_element(By.XPATH, '//*[@id="GapListArea"]/table')

# 取得したテーブルからtdタグの中身をリストで取得
tdlist = element.find_elements(By.TAG_NAME, 'td')

# 空白を削除
tdlist = [elem for elem in tdlist if elem.text != '']

# リストの中身をcsvに出力
with open('gap.csv', 'w') as f:
    for elem in tdlist:
        f.write(elem.text + '\n')


# リストの中身をログに出力
for elem in tdlist:
    print(elem.text)



# ウインドウを閉じる
driver.close()