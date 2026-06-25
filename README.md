# JobCenter

个人定时任务中心,基于 [青龙 (qinglong)](https://github.com/whyour/qinglong) 定时任务平台搭建,独立维护。

用来托管一组定时抓取 / 自动化脚本,通过青龙 Web 面板管理调度,任务有变化时发邮件提醒。

## 当前任务

| 任务 | 脚本 | 调度 | 说明 |
|---|---|---|---|
| FedEx Fuel Surcharge | [`fedex_fuel_surcharge.py`](docker/data/scripts/fedex_fuel_surcharge.py) | 每天 08:00 (太平洋) | 抓取 fedex.com 当前生效的 Ground / Express / Express Freight 燃油附加费,**值变化时**邮件提醒 |
| FedEx Zone Chart | [`fedex_zone_chart.py`](docker/data/scripts/fedex_zone_chart.py) | 每月 7 号 08:00 (太平洋) | 抓取指定 origin ZIP 的美国国内 zone chart PDF,保存归档并邮件汇报(含与上月对比) |

> 脚本均为纯 Python 标准库实现,无额外依赖;复用青龙内置 `notify` 模块发通知。

## 运行

使用青龙官方 Docker 镜像运行(不从源码构建):

```bash
cd docker
docker compose up -d
```

- 面板地址:http://localhost:5700
- 数据持久化:`docker/data/`(已 gitignore,含数据库 / 配置 / 密钥 / 日志 / 下载文件)
- 时区:容器设为 **太平洋时间**(`America/Los_Angeles`,见 [`docker/docker-compose.yml`](docker/docker-compose.yml)),日志时间戳与定时触发时刻均为太平洋时间,自动处理夏令时

## 新增一个任务

1. 把脚本放到 `docker/data/scripts/`(会自动出现在青龙脚本管理里)
2. 在面板 **定时任务 → 新建任务** 填命令(如 `task xxx.py`)和 cron 表达式;或用青龙内部 token 调 API 创建
3. 需要纳入版本库时,在 `.gitignore` 里为该脚本加一条白名单(参照现有两个脚本的写法),再 `git add` 提交

## 通知(邮件)

任务通过青龙内置 notify 发邮件。在面板初始化向导或 **系统设置 → 通知设置** 配置 SMTP:

- 邮箱服务名填 [services.json](https://github.com/nodemailer/nodemailer/blob/master/lib/well-known/services.json) 里的代号(如 `Gmail`)
- 密码用邮箱的**应用专用密码**(Gmail 需先开两步验证),不是登录密码

## 与上游 qinglong 的关系

本仓库是青龙某个版本的完整副本 + 上述个性化任务与配置,已脱离上游、独立演进。青龙本身的用法 / 文档参见 [上游仓库](https://github.com/whyour/qinglong)。
