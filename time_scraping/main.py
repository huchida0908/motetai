# %%
from selenium import webdriver
import chromedriver_binary
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup

# %% オプションの設定
options = Options()

# Chromeプロファイルの指定
# options.add_argument("--user-data-dir=/Users/shoheimaeda/Library/Application Support/Google/Chrome")
# options.add_argument("--profile-directory=Profile 3")

# Selenium実行後もChromeを開いたままにする
options.add_experimental_option('detach', True)

# Chromeブラウザを開く
driver = webdriver.Chrome(options=options)

# %% 現在のタブでページを開く
url = "http://racenow-motegi-1.racelive.jp/"
driver.get(url)
# %%
# <iframe>にスイッチ
iframe = driver.find_element(By.TAG_NAME, "iframe")  # ここでは最初の<iframe>を取得しています。必要に応じて適切なものを指定してください。
driver.switch_to.frame(iframe)

# <iframe>内のHTMLを取得
html = driver.page_source

# %% BeautifulSoupでHTMLを解析
soup = BeautifulSoup(html, "html.parser")

# <tbody>タグの情報を取得
tbody = soup.find("tbody")  # ここでは最初の<tbody>を取得しています。必要に応じて適切なものを指定してください。

print(tbody)
# %%
