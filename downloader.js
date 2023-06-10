// ==UserScript==
// @name         bilibili-subtitle-to-text
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  一次性展示bilibili的cc字幕。适合需要快速阅读字幕的场景。
// @author       You
// @match        https://www.bilibili.com/video/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        GM_addStyle
// @require      https://cdn.bootcdn.net/ajax/libs/jquery/3.6.0/jquery.min.js
// @license      GNU GPLv3
// ==/UserScript==

// us for userscript
GM_addStyle(`
.us-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  background: #FFF;
  padding: 22px;
  width: auto;
  max-width: 500px;
  z-index: 9999;
  transform: translate(-50%, -50%);
}

.us-popup-inner {
    margin: 0 22px;
}

.us-popup-close {
  cursor: pointer;
  background: transparent;
  border: 0;
  padding: 0;
  z-index: 10000;
  width: 44px;
  height: 44px;
  line-height: 44px;
  position: absolute;
  right: 0;
  top: 0;
  opacity: 0.65;
  font-size: 28px;
}

.us-popup-reader {
    overflow-y: scroll;
    max-height: 500px;
}
`);


function generatePopupDiv() {
    let popup = $("<div class='us-popup'></div>");
    let inner = $("<div class='us-popup-inner'></div>");
    let btn = $("<button type='button' class='us-popup-close'>×</button>");
    btn.on("click", () => {
        popup.hide();
    });
    popup.append(btn);
    popup.append(inner);
    popup.hide();
    return [popup, inner];
}


(function () {
    "use strict";

    let downloadLink = $(`
    <div class="video-toolbar-right-item">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-badge-cc" viewBox="0 0 16 16">
            <path d="M3.708 7.755c0-1.111.488-1.753 1.319-1.753.681 0 1.138.47 1.186 1.107H7.36V7c-.052-1.186-1.024-2-2.342-2C3.414 5 2.5 6.05 2.5 7.751v.747c0 1.7.905 2.73 2.518 2.73 1.314 0 2.285-.792 2.342-1.939v-.114H6.213c-.048.615-.496 1.05-1.186 1.05-.84 0-1.319-.62-1.319-1.727v-.743zm6.14 0c0-1.111.488-1.753 1.318-1.753.682 0 1.139.47 1.187 1.107H13.5V7c-.053-1.186-1.024-2-2.342-2C9.554 5 8.64 6.05 8.64 7.751v.747c0 1.7.905 2.73 2.518 2.73 1.314 0 2.285-.792 2.342-1.939v-.114h-1.147c-.048.615-.497 1.05-1.187 1.05-.839 0-1.318-.62-1.318-1.727v-.743z"/>
            <path d="M14 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h12zM2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2z"/>
        </svg>
        下载字幕
    </div>`);

    let popup = generatePopupDiv();
    let popupout = popup[0];
    popup = popup[1];
    let popupSelector = $("<div />");
    let popupReader = $("<div class='us-popup-reader'/>");
    popupReader.hide();
    popup.append(popupSelector);
    popup.append(popupReader);
    let chose = false;

    let urlParameters = window.location.pathname.split("/")
    let bvid = urlParameters.pop()
    if (bvid == "") bvid = urlParameters.pop()

    // insert link
    setTimeout(() => {
        let handler = setInterval(() => {
            let toolbar = $("#arc_toolbar_report .video-toolbar-right .video-note");
            if (toolbar.length != 0) {
                popupout.appendTo($("body"));
                toolbar.css("margin-right", "18px");
                downloadLink.insertAfter(toolbar);
                clearInterval(handler);
            }
        }, 500);
    }, 3000);


    // show popup and fetch information
    downloadLink.on("click", () => {
        popupReader.hide();
        popupSelector.show();
        /*if (chose) {
            popupout.show();
            return;
        }*/
        let cur_page = (new URLSearchParams(window.location.search)).get('p') - 1;
        if (!cur_page || cur_page == -1) {
            cur_page = 0;
        }
        fetch("https://api.bilibili.com/x/web-interface/view?bvid=" + bvid, {
            credentials: "include"
        })
            .then(res => res.json())
            .then(data => {
                //console.log(data)
                if (data.code != 0) {
                    throw new Error(data.message);
                }
                return fetch(`https://api.bilibili.com/x/player/v2?aid=${data.data.aid}&cid=${data.data.pages[cur_page].cid}`, {
                    credentials: "include"
                })
            })
            .then(res => res.json())
            .then(data => {
                console.log(data)
                if (data.code != 0) {
                    throw new Error(data.message);
                }
                let subtitles = data.data.subtitle.subtitles;
                if (subtitles.length == 0) {
                    popupSelector.html("无字幕");
                } else {
                    popupSelector.html("");
                    for (let subtitle of subtitles) {
                        let link = $("<a>" + subtitle.lan_doc + "</a>");
                        link.on("click", () => {
                            fetch(subtitle.subtitle_url.replace('http:', 'https:'))
                                .then(res => res.json())
                                .then(data => {
                                    popupReader.html("");
                                    for (let line of data.body) {
                                        popupReader.append("<p>" + line.content + "</p>");
                                    }
                                    popupReader.show();
                                    popupSelector.hide();
                                    //chose = true
                                });
                        });
                        popupSelector.append(link);
                    }
                }
                popupout.show();
            })
            .catch(err => {
                popup.html("获取字幕信息失败");
                console.error(err);
                popupout.show();
            })
    });
})();
