# %%
from selenium import webdriver
import chromedriver_binary
from selenium.webdriver.chrome.options import Options

# オプションの設定
options = Options()

# Chromeプロファイルの指定
options.add_argument("--user-data-dir=/Users/shoheimaeda/Library/Application Support/Google/Chrome")
options.add_argument("--profile-directory=Profile 3")

# Selenium実行後もChromeを開いたままにする
options.add_experimental_option('detach', True)

# Chromeブラウザを開く
driver = webdriver.Chrome(options=options)

# %% 現在のタブでページを開く
url = "http://racenow-motegi-1.racelive.jp/"
driver.get(url)