# Bilibili Subtitle to Text

一个把b站的cc字幕一次性显示出来的脚本。
![](readme-1.png)

## 如何使用
里导入到脚本管理器：https://greasyfork.org/zh-CN/scripts/460073-bilibili-subtitle-to-text

你也可以直接把js复制粘贴进去。

脚本管理器导入后，点击播放器下面的“字幕”，选择需要的字幕即可。

如果切换了分p，需要关闭字幕窗口重新选择一次。

## feature
- 支持多个字幕选择
- 支持窗口拖动和缩放（调用[Draggable-Resizable-Dialog](https://github.com/ZulNs/Draggable-Resizable-Dialog/)）
- 支持点击时间跳转
- 支持以文本或json格式下载当前分p的字幕

## 注意事项
为了让字幕按钮那一栏的字不换行，脚本对其他按钮的width和margin-right有改动。可能会造成与其他脚本的兼容性问题。
