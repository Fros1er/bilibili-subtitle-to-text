// ==UserScript==
// @name         bilibili-subtitle-to-text
// @namespace    http://tampermonkey.net/
// @version      0.33
// @description  一次性展示bilibili的cc字幕。适合需要快速阅读字幕的场景。
// @author       You
// @match        https://www.bilibili.com/video/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_addStyle
// @grant        GM.getValue
// @grant        GM.setValue
// @require      https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/jquery/3.6.0/jquery.min.js
// @license      GNU GPLv3
// ==/UserScript==

// us for userscript
GM_addStyle(`
  .us-popup-reader {
  }
  
  .us-popup-reader::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0,0,0,0.3);
    background-color: #F5F5F5;
  }
  
  .us-popup-reader::-webkit-scrollbar {
    width: 6px;
      height: 6px;
    background-color: #F5F5F5;
  }
  
  .us-popup-reader::-webkit-scrollbar-thumb {
    background-color: darkgrey;
  }
  
  .us-lyric-line {
      display: flex;
  }
  .us-lyric-line span {
    margin-left: 0.75rem;
  }
  
  .us-lyric-line-time {
      flex: none;
      overflow: hidden;
      width:66px;
  }
  
  .us-lyric-line-content {
    flex-grow: 1;
    flex-basis: 0;
    word-wrap: break-word;
    flex-wrap: wrap;
  }

  .us-lyric-current {
    font-weight: bold;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  
  .us-toolbar {
      position: absolute;
      top: 0;
      right: 48px;
      height: 32px;
      line-height: 32px;
      white-space: nowrap;
  }
  
  .us-toolbar a {
      margin-right: 8px;
  }

  .us-setting {}
  .us-setting form { 
    display: table;
    border-spacing: 10px;
  }
  .us-setting p { display: table-row; }
  .us-setting label { display: table-cell; }
  .us-setting input { display: table-cell; }
  .us-input-text {
    padding: 0 5px;
    border-radius: 5px;
  }
  .us-input-submit {
    margin-left: 10px;
    min-width: 3rem;
  }
  .us-fab-div { 
    position: absolute;
    right: 48px;
    bottom: 32px;
    display: flex;
    flex-direction: column;
  }
  .us-fab-button {
    height: 32px;
    weight: 32px;
    background: transparent;
    color: #2C3E50;
  }
  .us-fab-button svg:hover {
    color: #17202A;
    background: lightgrey;
  }
  .us-fab-button svg {
    border-radius: 16px;
    background: #f6f6f6;
  }
`)

// modify origin UI to fit new button
GM_addStyle(`
  .video-toolbar-container .video-toolbar-left .toolbar-left-item-wrap {
      margin-right: 2px!important;
  }
  .video-toolbar-container .video-toolbar-left .toolbar-left-item-wrap .video-toolbar-left-item {
      width: 85px!important;
  }
`)

function fixNumber(n) {
  return (n).toLocaleString("en-US", { minimumIntegerDigits: 2, useGrouping: false })
}

function parseTime(t) {
  t = parseInt(t)
  return `${fixNumber(parseInt(t / 60))}:${fixNumber(t % 60)}`
}

const SettingType = Object.freeze({
  Text: Symbol("Text"),
  Submit: Symbol("Submit")
})


class Dialog {
  constructor() {
    this.dialogDiv = $(`
      <div id="ZulNs-dialog" class="ZulNs-dialog" style="min-width:400px; min-height:280px;">
        <div class="titlebar">Title</div>
        <button name="close">&#x2716</button>
        <div class="us-toolbar"></div>
        <div class="content">
          <div id="content"></div>
          <div class="us-setting">
            <form></form>
          </div>
        </div>
        <div class="us-fab-div"></div>
      </div>
    `)
    this._titleBar = this.dialogDiv.find(".titlebar")
    this.contentPane = this.dialogDiv.find("#content")
    this.contentScrollPane = this.dialogDiv.find(".content")
    this.settingPane = this.dialogDiv.find(".us-setting")
    this.settingForm = this.settingPane.find("form")
    this.settingPane.hide()
    this._toolbar = this.dialogDiv.find(".us-toolbar")
    this.fabDiv = this.dialogDiv.find(".us-fab-div") // floating action button(fab)
  }
  init() {
    this.dialogDiv.appendTo($("body"))
    this.dialogBox = new DialogBox("ZulNs-dialog", () => { })
  }
  show() {
    this.dialogBox.showDialog()
  }
  isShow() {
    return this.dialogDiv.css("display") != "none"
  }
  setTitle(text) {
    this._titleBar.html(text)
  }
  addToolbarEntry(text, cb) {
    let link = $(`<a>${text}</a>`)
    link.on("click", cb)
    this._toolbar.append(link)
    return link
  }
  addSettingEntry(name, type) {
    if (type === SettingType.Submit) {
      let submit = $(`<input type="submit" class="us-input-submit" value="${name}">`)
      this.settingForm.append(submit)
      return submit
    }

    let line = $(`<p><label for="${name}">${name}: </label></p>`)
    let input = null
    if (type === SettingType.Text) {
      input = $(`<input id="${name}" class="us-input-text" type="text">`)
    } else {
      console.error("Unknown SettingType: " + type)
      return
    }
    line.append(input)
    this.settingForm.append(line)
    return line
  }
  changeFontSize(font) {
    this.dialogDiv.css({ fontSize: `${font}px` })
  }
}

(async function () {
  "use strict"

  async function request(url) {
    return await fetch(url, { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        if (data.code != 0) {
          throw new Error(data.message)
        }
        return data
      })
  }

  async function get_bilibili_video_info(bvid) {
    return (await request(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)).data
  }

  async function get_bilibili_page_info(aid, cid) {
    return (await request(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`)).data
  }

  let settings = null
  try {
    settings = JSON.parse(await GM.getValue("us-bst-settings"))
  } catch (err) {
    console.error(err)
    settings = {
      "font": 14,
      "music_filter_rate": 0.85
    }
  }

  let dialog = new Dialog()
  dialog.changeFontSize(settings.font)
  let video = null

  dialog.contentPane.addClass("us-popup-reader")
  let downloadGenerateLink = dialog.addToolbarEntry("下载字幕", () => { })
  let downloadLink = dialog.addToolbarEntry("下载字幕文本", () => { })
  let downloadJsonLink = dialog.addToolbarEntry("下载字幕Json", () => { })
  let downloadSrtLink = dialog.addToolbarEntry("下载字幕Srt", () => { })
  downloadGenerateLink.hide()
  downloadLink.hide()
  downloadJsonLink.hide()
  downloadSrtLink.hide()

  let fontSetting = dialog.addSettingEntry("字号", SettingType.Text)
  let musicFilterRateSetting = dialog.addSettingEntry("歌词过滤阈值", SettingType.Text)
  dialog.addSettingEntry("确定", SettingType.Submit)
  let cancel = dialog.addSettingEntry("取消", SettingType.Submit)
  dialog.addToolbarEntry("设置", () => {
    fontSetting.find("input").val(settings.font)
    musicFilterRateSetting.find("input").val(settings.music_filter_rate)
    dialog.settingPane.show()
    dialog.contentPane.hide()
  })
  cancel.on("click", () => {
    dialog.settingPane.hide()
    dialog.contentPane.show()
  })
  dialog.settingForm.on("submit", () => {
    settings.font = fontSetting.find("input").val()
    settings.music_filter_rate = musicFilterRateSetting.find("input").val()
    ; (async function () {
      await GM.setValue("us-bst-settings", JSON.stringify(settings))
    })()
    dialog.changeFontSize(settings.font)
    dialog.settingPane.hide()
    dialog.contentPane.show()
    return false
  })


  let urlParameters = window.location.pathname.split("/")
  let bvid = urlParameters.pop()
  if (bvid == "") bvid = urlParameters.pop()

  // insert link
  let subtitleBtn = $(`
    <div class="video-toolbar-right-item">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="video-note-icon video-toolbar-item-icon" viewBox="0 0 16 16">
            <path d="M3.708 7.755c0-1.111.488-1.753 1.319-1.753.681 0 1.138.47 1.186 1.107H7.36V7c-.052-1.186-1.024-2-2.342-2C3.414 5 2.5 6.05 2.5 7.751v.747c0 1.7.905 2.73 2.518 2.73 1.314 0 2.285-.792 2.342-1.939v-.114H6.213c-.048.615-.496 1.05-1.186 1.05-.84 0-1.319-.62-1.319-1.727v-.743zm6.14 0c0-1.111.488-1.753 1.318-1.753.682 0 1.139.47 1.187 1.107H13.5V7c-.053-1.186-1.024-2-2.342-2C9.554 5 8.64 6.05 8.64 7.751v.747c0 1.7.905 2.73 2.518 2.73 1.314 0 2.285-.792 2.342-1.939v-.114h-1.147c-.048.615-.497 1.05-1.187 1.05-.839 0-1.318-.62-1.318-1.727v-.743z"/>
            <path d="M14 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h12zM2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2z"/>
        </svg>
        字幕
    </div>`)

  setTimeout(() => {
    let handler = setInterval(() => {
      let toolbar = $("#arc_toolbar_report .video-toolbar-right .video-tool-more")
      if (toolbar.length != 0) {
        video = document.querySelector("video")
        $(video).on("timeupdate", () => {
          updateCurrentSubtitle()
        })
        $(video).on("seeking", () => {
          updateCurrentSubtitle()
        })
        dialog.init()
        toolbar.css("margin-right", "18px")
        subtitleBtn.insertBefore(toolbar)
        $(".arc_toolbar_report").css("justify-content", "initial")
        clearInterval(handler)
      }
    }, 500)
  }, 3000)

  let subtitleList = []
  let prevTime = 0
  let lastSubtitleIdx = 0
  function updateCurrentSubtitle() {
    if (subtitleList.length == 0) {
      return
    }
    const time = video.currentTime
    let start = lastSubtitleIdx
    if (time < prevTime) {
      start = 0
    }
    for (; start < subtitleList.length - 1; start++) {
      if (subtitleList[start].time <= time && time < subtitleList[start + 1].time) {
        break
      }
    }
    if (lastSubtitleIdx != start) {
      subtitleList[lastSubtitleIdx].span.removeClass("us-lyric-current")
      subtitleList[start].span.addClass("us-lyric-current")
      lastSubtitleIdx = start
    }
    prevTime = time
  }
  const backButton = $(`
  <button class="us-fab-button">
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="bi bi-arrow-left-circle" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8m15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-4.5-.5a.5.5 0 0 1 0 1H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5z"/>
    </svg>
  </button>
`)
  dialog.fabDiv.append(backButton)
  backButton.on("click", () => {
    if (subtitleList.length == 0) {
      return
    }
    const scrollPane = dialog.contentScrollPane
    const span = subtitleList[lastSubtitleIdx].span
    let top = span.offset().top - scrollPane.offset().top + scrollPane.scrollTop()
    top = Math.max(0, top - 4 * settings["font"] * 1.5)
    scrollPane.animate({
      scrollTop: top
    }, 1000)
  })

  async function useSubtitle(subtitle, filename_without_ext) {
    dialog.setTitle(subtitle.lan_doc)
    let data = await fetch(subtitle.subtitle_url.replace("http:", "https:")).then(res => res.json())

    dialog.contentPane.html("")
    subtitleList = []
    for (let line of data.body) {
      if (line.music && line.music > settings.music_filter_rate) {
        continue
      }
      let link = $(`<a class="us-lyric-line-time">${parseTime(line.from)}</a>`)
      link.on("click", () => {
        video.currentTime = line.from
      })
      let lineDiv = $("<div class=\"us-lyric-line\" />")
      let span = $(`<span class="us-lyric-line-content">${line.content}</span></div>`)
      lineDiv.append(link)
      lineDiv.append(span)
      dialog.contentPane.append(lineDiv)
      subtitleList.push({ time: line.from, span: span })
    }
    if (subtitleList.length != 0) {
      subtitleList[0].span.addClass("us-lyric-current")
    }
    updateCurrentSubtitle()

    downloadGenerateLink.on("click", () => {
      let subtitleText = ""
      for (let line of data.body) {
        subtitleText += line.content + "\n"
      }
      downloadLink.attr("href", `data:plain/text;charset=utf-8,${encodeURIComponent(subtitleText)}`)
      downloadJsonLink.attr("href", `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data.body))}`)
      downloadSrtLink.attr("href", getSrtLink(data.body))
      downloadLink.attr("download", `${filename_without_ext}.txt`)
      downloadJsonLink.attr("download", `${filename_without_ext}.json`)
      downloadSrtLink.attr("download", `${filename_without_ext}.srt`)
      downloadLink.show()
      downloadJsonLink.show()
      downloadSrtLink.show()
      downloadGenerateLink.hide()
    })
    downloadGenerateLink.show()
  }

  function getSrtLink(data) {
    function getSrt(data) {
      const _ts = this;
      let result = ``;
      data.forEach((item, index) => {
        result += echoSrt(item, index);
      });
      return result;
    }
    function echoSrt(data, index) {
      let str = ``;
      str += index + 1;
      str += `\r\n`;

      str += `${formatTime(data.from)} --> ${formatTime(data.to)}\r\n`;

      str += `${data.content}\r\n`;

      str += `\r\n`;
      return str;
    }
    function formatTime(num) {
      num = num * 1000;
      let h = (() => {
            let t = num / 60 / 60 / 1000;
            return t >= 1 ? ~~t : 0;
          })(),
          m = (() => {
            let t = [num - (h * 60 * 60 * 1000)] / 60 / 1000;
            return t >= 1 ? ~~t : 0;
          })(),
          s = (() => {
            let t = [num - (h * 60 * 60 * 1000) - (m * 60 * 1000)] / 1000;
            return t >= 1 ? ~~t : 0;
          })(),
          ms = (() => {
            let t = [num - (h * 60 * 60 * 1000) - (m * 60 * 1000) - (s * 1000)];
            return t >= 1 ? ~~t : 0;
          })();
      return `${fillIn(h, 2)}:${fillIn(m, 2)}:${fillIn(s, 2)},${fillIn(ms, 3)}`;
    }
    function fillIn(num, len) {
      num = `` + num;
      len = len - num.length;
      if (len) {
        for (let i = 0; i < len; i++) {
          num = `0${num}`;
        };
      };
      return num;
    }
    const srtContent = getSrt(data)
    // 创建一个Blob对象
    var blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return url
  }

  async function getSubtitleList() {
    let cur_page = (new URLSearchParams(window.location.search)).get("p") - 1
    if (!cur_page || cur_page == -1) {
      cur_page = 0
    }
    try {
      let video_info = await get_bilibili_video_info(bvid)
      let page_info = await get_bilibili_page_info(video_info.aid, video_info.pages[cur_page].cid)
      const video_name = video_info.title
      const page_name = video_info.pages[cur_page].part
      let subtitles = page_info.subtitle.subtitles
      if (subtitles.length == 0) {
        dialog.contentPane.html("无字幕")
      } else {
        dialog.contentPane.html("")
        for (let subtitle of subtitles) {
          let link = $("<a>" + subtitle.lan_doc + "</a>")
          link.on("click", () => {
            useSubtitle(subtitle, `${video_name}-p${cur_page}-${page_name}`)
          })
          dialog.contentPane.append(link)
        }
      }
    } catch (e) {
      dialog.contentPane.html(`获取字幕信息失败<br />${e}`)
      console.error(e)
    }
  }

  // show popup and fetch information
  subtitleBtn.on("click", () => {
  // titlebar.html()
    dialog.setTitle("选择字幕")
    dialog.show()
    dialog.contentPane.html("正在加载字幕列表")
    getSubtitleList()
  })
})()


// https://github.com/ZulNs/Draggable-Resizable-Dialog/
// On MIT License
GM_addStyle(`
  .ZulNs-dialog {
    // display: none; /* not visible by default */
    font-family: Verdana, sans-serif;
    font-size: 14px;
    font-weight: 400;
    color: #212F3D;
    background: #f6f6f6;
      box-shadow: 0 3px 25px 0 rgba(0,0,0,.3);
      border: 1px solid #e3e5e7; /* change allowed; Border to separate multipe dialog boxes */
    border-radius: 8px;
      margin: 0;
    position: fixed;
      z-index: 9999!important;
      height: 480px;
  }
  .ZulNs-dialog .titlebar {
    height: 32px; /* same as .ZulNs-dialog>button height */
    line-height: 32px; /* same as .ZulNs-dialog>button height */
    vertical-align: middle;
    padding: 0 8px 0 8px; /* change NOT allowed */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: move;
  }
  .ZulNs-dialog .content {
    position: absolute;
    top: 48px; /* change allowed */
    left: 16px; /* change NOT allowed */
    overflow: auto;
  }
  .ZulNs-dialog .buttonpane:before {
    width: 100%;
    height: 0;
    border-bottom: 1px solid; /* change allowed */
    content: '';
    position: absolute;
    top: -16px; /* change allowed */
  }
  .ZulNs-dialog .buttonpane {
    width: 100%;
    position: absolute;
    bottom: 16px; /* change allowed */
    right: 16px; /* change NOT allowed */
    white-space: nowrap; /* keep buttons on one line */
  }
  .ZulNs-dialog .buttonset {
    float: right;
  }
  .ZulNs-dialog button {
    -webkit-transition: 0.25s;
    transition: 0.25s;
      border: 0;
  }
  .ZulNs-dialog button::-moz-focus-inner {
    border: 0;
  }
  /* .ZulNs-dialog button.hover, */ /* Let's use standard hover */
  .ZulNs-dialog button:hover,
  .ZulNs-dialog button.active
  {
    cursor: pointer;
  }
  .ZulNs-dialog>button {
    width: 32px; /* change NOT allowed */
    height: 32px; /* same as .ZulNs-dialog .titlebar height */
    position: absolute;
    top: 0;
    right: 0;
    padding: 0;
    border: 0;
    font-size: 1.4em;
      background: #f6f6f6;
  }
  /* .ZulNs-dialog>button.hover, */
  .ZulNs-dialog>button:hover
  {
    background: lightgrey;
      border: 0;
  }
  .ZulNs-dialog>button.active {
    border: 0;
  }
  `)

/* eslint-disable */
function DialogBox(id, callback) {

var _minW = 100, // The exact value get's calculated
  _minH = 1, // The exact value get's calculated
  _resizePixel = 5,
  _hasEventListeners = !!window.addEventListener,
  _parent,
  _dialog,
  _dialogTitle,
  _dialogContent,
  _dialogButtonPane,
  _maxX, _maxY,
  _startX, _startY,
  _startW, _startH,
  _leftPos, _topPos,
  _isDrag = false,
  _isResize = false,
  _isButton = false,
  _isButtonHovered = false, // Let's use standard hover (see css)
  //_isClickEvent = true, // Showing several dialog boxes work better if I do not use this variable
  _resizeMode = "",
  _whichButton,
  _buttons,
  _tabBoundary,
  _callback, // Callback function which transfers the name of the selected button to the caller
  _zIndex, // Initial zIndex of this dialog box 
  _zIndexFlag = false, // Bring this dialog box to front 
  _setCursor, // Forward declaration to get access to this function in the closure
  _whichClick, // Forward declaration to get access to this function in the closure
  _setDialogContent, // Forward declaration to get access to this function in the closure

  _addEvent = function (elm, evt, callback) {
    if (elm == null || typeof (elm) == undefined)
      return
    if (_hasEventListeners)
      elm.addEventListener(evt, callback, false)
    else if (elm.attachEvent)
      elm.attachEvent("on" + evt, callback)
    else
      elm["on" + evt] = callback
  },

  _returnEvent = function (evt) {
    if (evt.stopPropagation)
      evt.stopPropagation()
    if (evt.preventDefault)
      evt.preventDefault()
    else {
      evt.returnValue = false
      return false
    }
  },

  // not used
  /*
  _returnTrueEvent = function(evt) {
      evt.returnValue = true;
      return true;
  },
  */

  // not used
  // Mybe we should be able to destroy a dialog box, too. 
  // In this case we should remove the event listeners from the dialog box but 
  // I do not know how to identfy which event listeners should be removed from the document.
  /*
  _removeEvent = function(elm, evt, callback) {
      if (elm == null || typeof(elm) == undefined)
          return;
      if (window.removeEventListener)
          elm.removeEventListener(evt, callback, false);
      else if (elm.detachEvent)
          elm.detachEvent('on' + evt, callback);
  },
  */

  _adjustFocus = function (evt) {
    evt = evt || window.event
    if (evt.target === _dialogTitle)
      _buttons[_buttons.length - 1].focus()
    else
      _buttons[0].focus()
    return _returnEvent(evt)
  },

  _onFocus = function (evt) {
    evt = evt || window.event
    evt.target.classList.add("focus")
    return _returnEvent(evt)
  },

  _onBlur = function (evt) {
    evt = evt || window.event
    evt.target.classList.remove("focus")
    return _returnEvent(evt)
  },

  _onClick = function (evt) {
    evt = evt || window.event
    //if (_isClickEvent)
    _whichClick(evt.target)
    //else
    //	_isClickEvent = true;
    return _returnEvent(evt)
  },

  _onMouseDown = function (evt) {
    evt = evt || window.event
    _zIndexFlag = true
    // mousedown might happen on any place of the dialog box, therefore 
    // we need to take care that this does not to mess up normal events 
    // on the content of the dialog box, i.e. to copy text
    if (!(evt.target === _dialog || evt.target === _dialogTitle || evt.target === _buttons[0]))
      return
    var rect = _getOffset(_dialog)
    _maxX = Math.max(
      document.documentElement["clientWidth"],
      document.body["scrollWidth"],
      document.documentElement["scrollWidth"],
      document.body["offsetWidth"],
      document.documentElement["offsetWidth"]
    )
    _maxY = Math.max(
      document.documentElement["clientHeight"],
      document.body["scrollHeight"],
      document.documentElement["scrollHeight"],
      document.body["offsetHeight"],
      document.documentElement["offsetHeight"]
    )
    if (rect.right > _maxX)
      _maxX = rect.right
    if (rect.bottom > _maxY)
      _maxY = rect.bottom
    _startX = evt.pageX
    _startY = evt.pageY
    _startW = _dialog.clientWidth
    _startH = _dialog.clientHeight
    _leftPos = rect.left
    _topPos = rect.top
    if (_isButtonHovered) {
      //_whichButton.classList.remove('hover');
      _whichButton.classList.remove("focus")
      _whichButton.classList.add("active")
      _isButtonHovered = false
      _isButton = true
    }
    else if (evt.target === _dialogTitle && _resizeMode == "") {
      _setCursor("move")
      _isDrag = true
    }
    else if (_resizeMode != "") {
      _isResize = true
    }
    var r = _dialog.getBoundingClientRect()
    return _returnEvent(evt)
  },

  _onMouseMove = function (evt) {
    evt = evt || window.event
    // mousemove might run out of the dialog box during drag or resize, therefore we need to 
    // attach the event to the whole document, but we need to take care that this  
    // does not to mess up normal events outside of the dialog box.
    if (!(evt.target === _dialog || evt.target === _dialogTitle || evt.target === _buttons[0]) && !_isDrag && _resizeMode == "")
      return
    if (_isDrag) {
      var dx = _startX - evt.pageX,
        dy = _startY - evt.pageY,
        left = _leftPos - dx,
        top = _topPos - dy,
        scrollL = Math.max(document.body.scrollLeft, document.documentElement.scrollLeft),
        scrollT = Math.max(document.body.scrollTop, document.documentElement.scrollTop)
      if (dx < 0) {
        if (left + _startW > _maxX)
          left = _maxX - _startW
      }
      if (dx > 0) {
        if (left < 0)
          left = 0
      }
      if (dy < 0) {
        if (top + _startH > _maxY)
          top = _maxY - _startH
      }
      if (dy > 0) {
        if (top < 0)
          top = 0
      }
      _dialog.style.left = left + "px"
      _dialog.style.top = top + "px"
      if (evt.clientY > window.innerHeight - 32)
        scrollT += 32
      else if (evt.clientY < 32)
        scrollT -= 32
      if (evt.clientX > window.innerWidth - 32)
        scrollL += 32
      else if (evt.clientX < 32)
        scrollL -= 32
      if (top + _startH == _maxY)
        scrollT = _maxY - window.innerHeight + 20
      else if (top == 0)
        scrollT = 0
      if (left + _startW == _maxX)
        scrollL = _maxX - window.innerWidth + 20
      else if (left == 0)
        scrollL = 0
      if (_startH > window.innerHeight) {
        if (evt.clientY < window.innerHeight / 2)
          scrollT = 0
        else
          scrollT = _maxY - window.innerHeight + 20
      }
      if (_startW > window.innerWidth) {
        if (evt.clientX < window.innerWidth / 2)
          scrollL = 0
        else
          scrollL = _maxX - window.innerWidth + 20
      }
      window.scrollTo(scrollL, scrollT)
    }
    else if (_isResize) {
      var dw, dh, w, h
      if (_resizeMode == "w") {
        dw = _startX - evt.pageX
        if (_leftPos - dw < 0)
          dw = _leftPos
        w = _startW + dw
        if (w < _minW) {
          w = _minW
          dw = w - _startW
        }
        _dialog.style.width = w + "px"
        _dialog.style.left = (_leftPos - dw) + "px"
      }
      else if (_resizeMode == "e") {
        dw = evt.pageX - _startX
        if (_leftPos + _startW + dw > _maxX)
          dw = _maxX - _leftPos - _startW
        w = _startW + dw
        if (w < _minW)
          w = _minW
        _dialog.style.width = w + "px"
      }
      else if (_resizeMode == "n") {
        dh = _startY - evt.pageY
        if (_topPos - dh < 0)
          dh = _topPos
        h = _startH + dh
        if (h < _minH) {
          h = _minH
          dh = h - _startH
        }
        _dialog.style.height = h + "px"
        _dialog.style.top = (_topPos - dh) + "px"
      }
      else if (_resizeMode == "s") {
        dh = evt.pageY - _startY
        if (_topPos + _startH + dh > _maxY)
          dh = _maxY - _topPos - _startH
        h = _startH + dh
        if (h < _minH)
          h = _minH
        _dialog.style.height = h + "px"
      }
      else if (_resizeMode == "nw") {
        dw = _startX - evt.pageX
        dh = _startY - evt.pageY
        if (_leftPos - dw < 0)
          dw = _leftPos
        if (_topPos - dh < 0)
          dh = _topPos
        w = _startW + dw
        h = _startH + dh
        if (w < _minW) {
          w = _minW
          dw = w - _startW
        }
        if (h < _minH) {
          h = _minH
          dh = h - _startH
        }
        _dialog.style.width = w + "px"
        _dialog.style.height = h + "px"
        _dialog.style.left = (_leftPos - dw) + "px"
        _dialog.style.top = (_topPos - dh) + "px"
      }
      else if (_resizeMode == "sw") {
        dw = _startX - evt.pageX
        dh = evt.pageY - _startY
        if (_leftPos - dw < 0)
          dw = _leftPos
        if (_topPos + _startH + dh > _maxY)
          dh = _maxY - _topPos - _startH
        w = _startW + dw
        h = _startH + dh
        if (w < _minW) {
          w = _minW
          dw = w - _startW
        }
        if (h < _minH)
          h = _minH
        _dialog.style.width = w + "px"
        _dialog.style.height = h + "px"
        _dialog.style.left = (_leftPos - dw) + "px"
      }
      else if (_resizeMode == "ne") {
        dw = evt.pageX - _startX
        dh = _startY - evt.pageY
        if (_leftPos + _startW + dw > _maxX)
          dw = _maxX - _leftPos - _startW
        if (_topPos - dh < 0)
          dh = _topPos
        w = _startW + dw
        h = _startH + dh
        if (w < _minW)
          w = _minW
        if (h < _minH) {
          h = _minH
          dh = h - _startH
        }
        _dialog.style.width = w + "px"
        _dialog.style.height = h + "px"
        _dialog.style.top = (_topPos - dh) + "px"
      }
      else if (_resizeMode == "se") {
        dw = evt.pageX - _startX
        dh = evt.pageY - _startY
        if (_leftPos + _startW + dw > _maxX)
          dw = _maxX - _leftPos - _startW
        if (_topPos + _startH + dh > _maxY)
          dh = _maxY - _topPos - _startH
        w = _startW + dw
        h = _startH + dh
        if (w < _minW)
          w = _minW
        if (h < _minH)
          h = _minH
        _dialog.style.width = w + "px"
        _dialog.style.height = h + "px"
      }
      _setDialogContent()
    }
    else if (!_isButton) {
      var cs, rm = ""
      if (evt.target === _dialog || evt.target === _dialogTitle || evt.target === _buttons[0]) {
        var rect = _getOffset(_dialog)
        if (evt.pageY < rect.top + _resizePixel)
          rm = "n"
        else if (evt.pageY > rect.bottom - _resizePixel)
          rm = "s"
        if (evt.pageX < rect.left + _resizePixel)
          rm += "w"
        else if (evt.pageX > rect.right - _resizePixel)
          rm += "e"
      }
      if (rm != "" && _resizeMode != rm) {
        if (rm == "n" || rm == "s")
          cs = "ns-resize"
        else if (rm == "e" || rm == "w")
          cs = "ew-resize"
        else if (rm == "ne" || rm == "sw")
          cs = "nesw-resize"
        else if (rm == "nw" || rm == "se")
          cs = "nwse-resize"
        _setCursor(cs)
        _resizeMode = rm
      }
      else if (rm == "" && _resizeMode != "") {
        _setCursor("")
        _resizeMode = ""
      }
      if (evt.target != _buttons[0] && evt.target.tagName.toLowerCase() == "button" || evt.target === _buttons[0] && rm == "") {
        if (!_isButtonHovered || _isButtonHovered && evt.target != _whichButton) {
          _whichButton = evt.target
          //_whichButton.classList.add('hover');
          _isButtonHovered = true
        }
      }
      else if (_isButtonHovered) {
        //_whichButton.classList.remove('hover');
        _isButtonHovered = false
      }
    }
    return _returnEvent(evt)
  }

_onMouseUp = function (evt) {
  evt = evt || window.event
  if (_zIndexFlag) {
    _dialog.style.zIndex = _zIndex + 1
    _zIndexFlag = false
  } else {
    _dialog.style.zIndex = _zIndex
  }
  // mousemove might run out of the dialog box during drag or resize, therefore we need to 
  // attach the event to the whole document, but we need to take care that this  
  // does not to mess up normal events outside of the dialog box.
  if (!(evt.target === _dialog || evt.target === _dialogTitle || evt.target === _buttons[0]) && !_isDrag && _resizeMode == "")
    return
  //_isClickEvent = false;
  if (_isDrag) {
    _setCursor("")
    _isDrag = false
  }
  else if (_isResize) {
    _setCursor("")
    _isResize = false
    _resizeMode = ""
  }
  else if (_isButton) {
    _whichButton.classList.remove("active")
    _isButton = false
    _whichClick(_whichButton)
  }
  //else
  //_isClickEvent = true;
  return _returnEvent(evt)
},

  _whichClick = function (btn) {
    _dialog.style.display = "none"
    if (_callback)
      _callback(btn.name)
  },

  _getOffset = function (elm) {
    var rect = elm.getBoundingClientRect(),
      offsetX = window.scrollX || document.documentElement.scrollLeft,
      offsetY = window.scrollY || document.documentElement.scrollTop
    return {
      left: rect.left + offsetX,
      top: rect.top + offsetY,
      right: rect.right + offsetX,
      bottom: rect.bottom + offsetY
    }
  },

  _setCursor = function (cur) {
    _dialog.style.cursor = cur
    _dialogTitle.style.cursor = cur
    _buttons[0].style.cursor = cur
  },

  _setDialogContent = function () {
    // Let's try to get rid of some of constants in javascript but use values from css
    var _dialogContentStyle = getComputedStyle(_dialogContent),
      _dialogButtonPaneStyle,
      _dialogButtonPaneStyleBefore
    // if (_buttons.length > 1) {
    //     _dialogButtonPaneStyle = getComputedStyle(_dialogButtonPane)
    //     _dialogButtonPaneStyleBefore = getComputedStyle(_dialogButtonPane, ":before")
    // }

    var w = _dialog.clientWidth
      - parseInt(_dialogContentStyle.left) // .ZulNs-dialog .content { left: 16px; }
      - 16 // right margin?
      ,
      h = _dialog.clientHeight - (
        parseInt(_dialogContentStyle.top) // .ZulNs-dialog .content { top: 48px } 
        + 16 // ?
        // + (_buttons.length > 1 ?
        //     + parseInt(_dialogButtonPaneStyleBefore.borderBottom) // .ZulNs-dialog .buttonpane:before { border-bottom: 1px; }
        //     - parseInt(_dialogButtonPaneStyleBefore.top) // .ZulNs-dialog .buttonpane:before { height: 0; top: -16px; }
        //     + parseInt(_dialogButtonPaneStyle.height) // .ZulNs-dialog .buttonset button { height: 32px; }
        //     + parseInt(_dialogButtonPaneStyle.bottom) // .ZulNs-dialog .buttonpane { bottom: 16px; }
        //     : 0)
      ) // Ensure to get minimal height
    _dialogContent.style.width = w + "px"
    _dialogContent.style.height = h + "px"

    if (_dialogButtonPane) // The buttonpane is optional
      _dialogButtonPane.style.width = w + "px"

    _dialogTitle.style.width = (w - 16) + "px"
  },

  _showDialog = function () {
    _dialog.style.display = "block"
    // if (_buttons[1]) // buttons are optional
    //     _buttons[1].focus();
    // else
    //     _buttons[0].focus();
  },

  _init = function (id, callback) {
    _dialog = document.getElementById(id)
    _callback = callback // Register callback function

    _dialog.style.visibility = "hidden" // We dont want to see anything..
    _dialog.style.display = "block" // but we need to render it to get the size of the dialog box

    _dialogTitle = _dialog.querySelector(".titlebar")
    _dialogContent = _dialog.querySelector(".content")
    _dialogButtonPane = _dialog.querySelector(".buttonpane")
    _buttons = _dialog.querySelectorAll("button")  // Ensure to get minimal width

    // Let's try to get rid of some of constants in javascript but use values from css
    var _dialogStyle = getComputedStyle(_dialog),
      _dialogTitleStyle = getComputedStyle(_dialogTitle),
      _dialogContentStyle = getComputedStyle(_dialogContent),
      _dialogButtonPaneStyle,
      _dialogButtonPaneStyleBefore,
      _dialogButtonStyle
    // if (_buttons.length > 1) {
    //     _dialogButtonPaneStyle = getComputedStyle(_dialogButtonPane)
    //     _dialogButtonPaneStyleBefore = getComputedStyle(_dialogButtonPane, ":before")
    //     _dialogButtonStyle = getComputedStyle(_buttons[1])
    // }

    // Calculate minimal width
    _minW = Math.max(_dialog.clientWidth, _minW,
      // + (_buttons.length > 1 ?
      //     + (_buttons.length - 1) * parseInt(_dialogButtonStyle.width) // .ZulNs-dialog .buttonset button { width: 64px; }
      //     + (_buttons.length - 1 - 1) * 16 // .ZulNs-dialog .buttonset button { margin-left: 16px; } // but not for first-child
      //     + (_buttons.length - 1 - 1) * 16 / 2 // The formula is not correct, however, with fixed value 16 for margin-left: 16px it works
      //     : 0)
      0
    )
    _dialog.style.width = _minW + "px"

    // Calculate minimal height
    _minH = Math.max(_dialog.clientHeight, _minH,
      + parseInt(_dialogContentStyle.top) // .ZulNs-dialog .content { top: 48px } 
      + (2 * parseInt(_dialogStyle.border)) // .ZulNs-dialog { border: 1px }
      + 16 // ?
      + 12 // .p { margin-block-start: 1em; } // default
      + 12 // .ZulNs-dialog { font-size: 12px; } // 1em = 12px
      + 12 // .p { margin-block-end: 1em; } // default
      // + (_buttons.length > 1 ?
      //     + parseInt(_dialogButtonPaneStyleBefore.borderBottom) // .ZulNs-dialog .buttonpane:before { border-bottom: 1px; }
      //     - parseInt(_dialogButtonPaneStyleBefore.top) // .ZulNs-dialog .buttonpane:before { height: 0; top: -16px; }
      //     + parseInt(_dialogButtonPaneStyle.height) // .ZulNs-dialog .buttonset button { height: 32px; }
      //     + parseInt(_dialogButtonPaneStyle.bottom) // .ZulNs-dialog .buttonpane { bottom: 16px; }
      //     : 0)
    )
    _dialog.style.height = _minH + "px"

    _setDialogContent()

    // center the dialog box
    _dialog.style.left = ((window.innerWidth - _dialog.clientWidth) / 2) + "px"
    _dialog.style.top = ((window.innerHeight - _dialog.clientHeight) / 2) + "px"

    _dialog.style.display = "none" // Let's hide it again..
    _dialog.style.visibility = "visible" // and undo visibility = 'hidden'

    _dialogTitle.tabIndex = "0"

    _tabBoundary = document.createElement("div")
    _tabBoundary.tabIndex = "0"
    _dialog.appendChild(_tabBoundary)

    _addEvent(_dialog, "mousedown", _onMouseDown)
    // mousemove might run out of the dialog during resize, therefore we need to 
    // attach the event to the whole document, but we need to take care not to mess 
    // up normal events outside of the dialog.
    _addEvent(document, "mousemove", _onMouseMove)
    // mouseup might happen out of the dialog during resize, therefore we need to 
    // attach the event to the whole document, but we need to take care not to mess 
    // up normal events outside of the dialog.
    _addEvent(document, "mouseup", _onMouseUp)
    for (var i = 0; i < _buttons.length; i++) {
      if (_buttons[i].name == "close") {
        _addEvent(_buttons[i], "click", _onClick)
      }
      _addEvent(_buttons[i], "focus", _onFocus)
      _addEvent(_buttons[i], "blur", _onBlur)
    }
    _addEvent(_dialogTitle, "focus", _adjustFocus)
    _addEvent(_tabBoundary, "focus", _adjustFocus)

    _zIndex = _dialog.style.zIndex
  }

// Execute constructor
_init(id, callback)

// Public interface 
this.showDialog = _showDialog
return this
}
/* eslint-enable */
