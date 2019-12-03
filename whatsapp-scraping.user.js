// ==UserScript==
// @name         Whatsapp scraper
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Scrape all content from a selected whatsapp conversation
// @author       Frederik Duchi
// @match        https://web.whatsapp.com/
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.min.js
// @grant        none
// ==/UserScript==

(() => {
    'use strict';
    let json_conversation = [];

    // find the first previous element in the conversation that contains the date
    const findLastKownDate = $message => {
        const $previous = $message.previousElementSibling;
        if ($previous.classList.contains(`_3CGDY`)) {
            const $span = $previous.querySelector(`span`);
            if ($span.textContent != ``) {
                return $span.textContent;
            } else {
                return findLastKownDate($previous);
            }
        } else {
            return findLastKownDate($previous);
        }
    }

    // return the author if he is known, otherwise return `unkown`
    const getMessageAuthor = $message => {
        const $intro = $message.querySelector(`.copyable-text`);
        if ($intro) {
            const line = $intro.getAttribute(`data-pre-plain-text`);
            return line.split(`, `)[1].split(`] `)[1].slice(0, -2);
        } else if ($message.querySelector(`._1UWph`)) {
            return $message.querySelector(`._1UWph`).textContent;
        } else {
            return `Unknown`;
        }
    };

    // return the date if available, otherwiste recursive search for a whatsapp status message containing the date
    const getMessageDate = $message => {
        const $intro = $message.querySelector(`.copyable-text`);
        if ($intro) {
            const line = $intro.getAttribute(`data-pre-plain-text`);
            return line.split(`, `)[1].split(`] `)[0];
        } else {
            return findLastKownDate($message);
        }
    };

    // return time from the intro tag or the tag inside a media element
    const getMessageTime = $message => {
        const $intro = $message.querySelector(`.copyable-text`);
        if ($intro) {
            const line = $intro.getAttribute(`data-pre-plain-text`);
            return line.split(`,`)[0].slice(1);
        } else {
            return $message.querySelector(`._3fnHB`).textContent;;
        }
    };

    const getMessageText = $message => {
        const $text = $message.querySelector(`.selectable-text`);
        if ($text) {
            return $text.textContent
        } else {
            return ``;
        }
    };

    const getEmojis = $message => {
        const $text = $message.querySelector(`.selectable-text`);
        if ($text) {
            const emojis = Array.from($text.querySelectorAll(`img`));
            return emojis.map($emoji => $emoji.getAttribute(`data-plain-text`));
        }
        return [];
    };

    const startDownload = async (path, filename) => {
        const data = await fetch(path).then(response => {
            return response.blob();
        }).catch(() => {
            return ``;
        });

        return data;
    };

    const getMediaURL = async $element => {
        return await new Promise(resolve => {
            let counter = 0;
            const id = setInterval(() => {
                console.log(counter);
                if (counter === 10 || $element.getAttribute(`src`).startsWith(`blob:https://`)) {
                    resolve($element.getAttribute(`src`));
                    clearInterval(id);
                }
                counter++;
            }, 500);
        });
    };

    const getVideoURL = async () => {
        return await new Promise(resolve => {
            let counter = 0;
            const id = setInterval(() => {
                console.log(counter);
                // video was not found
                if (counter === 10) {
                    resolve(`file not found`);
                    clearInterval(id);
                }
                if (document.querySelector(`video`)) {
                    const url = document.querySelector(`video`).getAttribute(`src`);
                    resolve(url);
                    clearInterval(id);
                }
                counter++;
            }, 500);
        });
    };

    const getMedia = async ($message, filename) => {
        // check for an image
        const $image_container = $message.querySelector(`._3mdDl`);
        if ($image_container) {
            const $img = $image_container.querySelector(`img`);
            const $download_button = $image_container.querySelector(`button`);

            if ($download_button) {
                $download_button.click();
            }

            const url = await getMediaURL($img);
            const file = await startDownload(url, filename);

            if (url.startsWith(`data:image`)) {
                return { type: "image", path: `${filename}.jpeg`, status: `preview`, file: file };
            } else {
                return { type: "image", path: `${filename}.jpeg`, status: `ok`, file: file };
            }
        }

        // check for a video
        const $video_container = $message.querySelector(`.video-thumb span[data-icon="video-pip"]`);
        if ($video_container) {
            $video_container.click();

            const url = await getVideoURL();

            if (url !== `file not found`) {
                const file = await startDownload(url, filename);
                return { type: "video", path: `${filename}.mp4`, status: `ok`, file: file };
            } else {
                return { type: "video", path: ``, status: `not_found`, file: `` };
            }
        }

        // check for a gif
        const $gif_container = $message.querySelector(`._16iRL`);
        if ($gif_container) {
            const $video = $gif_container.querySelector(`video`);
            const url = $video.getAttribute(`src`);
            const file = await startDownload(url, filename);

            return { type: "gif", path: `${filename}.mp4`, status: `ok`, file: file };
        }

        return { type: `no_media`, path: ``, status: `not_found`, file: `` };
    };

    const parseConversationLine = async (title, messages, item, id) => {
        const $message = messages[item];
        if ($message) {
            // only parse incoming and outgoing messages, deny all other types (status updates from whatsapp)
            if ($message.classList.contains(`message-in`) || $message.classList.contains(`message-out`)) {
                const message = {};
                message.id = id;
                console.log(`parsing message with id ${id}`);

                // set the author, date and time depending on the first copyable-text in the line. Format is [hh:mm, m/d/yyyy] Author:
                // copyable-text is not set for messages only containing media: fallback is implementend in methods
                message.author = getMessageAuthor($message);
                message.date = getMessageDate($message);
                message.time = getMessageTime($message);

                // set the text mesage if available
                message.text = getMessageText($message);

                // fill an array with emoji used in the message text
                message.emojis = getEmojis($message);

                // check if the message contains media
                message.media = await getMedia($message, `wae_${id}`);

                json_conversation.push(message);
                //return message;

                id++;
            }
            item++;
            parseConversationLine(title, messages, item, id);
        } else {
            // remove any open containers if required
            document.querySelector(`._2sTOw`).innerHTML = ``;
            createZipFile(title);
        }
    };

    const createZipFile = title => {
        const zip = new JSZip();
        const folder = zip.folder(title);
        folder.file(`conversation.json`, JSON.stringify(json_conversation));

        json_conversation.forEach(message => {
            console.log(message.media.type);

            if (message.media.path !== ``) {
                console.log(`add ${message.media.path}`);
                folder.file(message.media.path, message.media.file);
            }
        });
        zip.generateAsync({ type: "blob" }).then(content => {
            console.log(content);
            const $a = document.createElement(`a`);
            document.body.appendChild($a);
            $a.href = window.URL.createObjectURL(content);
            $a.download = title;
            $a.click();
        });
        // clear the array
        json_conversation = [];
    };

    const parseConversation = (title, $header_container) => {
        $header_container.innerHTML = `start parsing...`;

        // select all messages from the conversation
        const messages = document.querySelectorAll(`.FTBzM`);

        parseConversationLine(title, messages, 0, 1);
    };

    /*
    const getLastDate = $container => {
        const $last_date = $container.querySelector(`._3CGDY > .a7otO`);
        return $last_date.textContent;
    };
    */

    const handleClickDownload = e => {
        // get the title of the conversation
        const $header_container = document.querySelector(`._3fs0K`);
        const title = $header_container.querySelector(`._19vo_`).textContent;

        // array that holds the last 10 scroll positions.  If all 10 items are equal means that we have reached the top of the conversation
        const lastScrolls = [];

        // selecting the scrollable message container
        const $scroll_container = document.querySelector(`._1_keJ`);

        // show message that the scrolling has started
        $header_container.innerHTML = `srcolling to the beginning of the conversation, might take a while depending on the length of the conversation`;

        // start scrolling to the top and check if the top is reached
        const id = setInterval(() => {
            const amount = document.querySelectorAll(`.FTBzM`).length;

            // TEMP HACK FOR LARGE CONVERSATIONS: ONLY DOWNLOAD 200 MESSAGES
            if (amount > 1000) {
                clearInterval(id);
                $header_container.innerHTML = `the top of the conversation has been reached, start parsing ${amount} items`;
                parseConversation(title, $header_container);
            }

            $header_container.innerHTML = `scrolling to the beginning of the conversation.  Amount of messages: ${amount}`;
            lastScrolls.push($scroll_container.scrollTop);
            if (lastScrolls.length === 10) {
                if (lastScrolls.every(x => x === lastScrolls[0])) {
                    clearInterval(id);
                    $header_container.innerHTML = `the top of the conversation has been reached, start parsing ${amount} items`;
                    parseConversation(title, $header_container);
                } else {
                    lastScrolls.length = 0;
                }
            }

            $scroll_container.scrollTo({ top: 1, left: 0, behavior: 'smooth' });
        }, 100);
    };

    const addDownloadButton = () => {
        // selecting the container of menu items in the left pane because the do not refresh when switching conversation
        const $menu_container = document.querySelector(`.sbcXq ._3lq69>span`);

        // creating a new menu element with a download icon, append it to the container and wait for the click event
        const $menu_item = document.createElement(`div`);
        $menu_item.classList.add(`_3j8Pd`);
        $menu_item.innerHTML = `<div role="button" title="Download..."><span data-icon="download" class=""><svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#263238" d="M18.9 10.3h-4V4.4H9v5.9H5l6.9 6.9 7-6.9zM5.1 19.2v2H19v-2H5.1z"></path></svg></span></div><span></span>`;
        $menu_container.appendChild($menu_item);
        $menu_item.addEventListener(`click`, handleClickDownload);
    };

    const start = () => {
        // check if the container a conversation exists on the DOM
        // and keep checking as long as not found.
        const $message_container = document.querySelector(`._1ays2`);
        if (!$message_container) {
            setTimeout(start, 200);
            return;
        }
        // add a download button once a conversation is found
        addDownloadButton();
    };

    start();
})();