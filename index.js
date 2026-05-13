const config = require('./config.json');
const express = require('express');
const jo = require('jpeg-autorotate');
const sharp = require('sharp');
const fs = require('fs');
const https = require('https');

var dataFile = config.simpleChatDataFile;
var cachePath = config.simpleChatAttachmentsCache;

//Web server config
const webapp = express();
webapp.use(express.json());
var webPort = config.webPort;

//Discord config
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
});
var botToken = config.discordBotToken;
var listenChannel = config.discordListenChannelId;
var postChannel = config.discordPostChannelId;
var allowedBots = config.allowedBots;
const safeExtensions = ["jpg", "gif", "png"];

//Web server to receive instructions on
//  This should usually be accessible only to local host and is used to integrate
//  Other services (like the SimpleChat service) with the bot
var server = webapp.listen(webPort, function() {
    var host = server.address().address;
    var port = server.address().port;
    console.log("🤖 Listening for messages to send to Discord at http://%s:%s", host, port);
    console.log("allowed bots are: " + JSON.stringify(allowedBots));
});

webapp.post('/post', function(req, res) {
    console.log("post request was: " + JSON.stringify(req.body));
    var message = req.body.content;
    message = convertEmoticons(message);
    message = convertWosaLinks(message);
    res.end("{'status':'ok'}");
    var channel = client.channels.cache.get(postChannel);
    var label = message ? "**" + req.body.username + "**: " + message : "**" + req.body.username + "**";
    var msgOptions = { content: label };
    if (req.body.attachments && req.body.attachments.length > 0) {
        var files = req.body.attachments
            .filter(function(a) { return safeExtensions.includes(a.extension.toLowerCase()); })
            .map(function(a) { return cachePath + a.filename; });
        if (files.length > 0)
            msgOptions.files = files;
    }
    channel.send(msgOptions).then(function(msg) {
        console.log("Sent message id: " + msg.id);
        discordIDToSimpleChat(req.body.uid, msg.id);
    });
});

webapp.post('/like', async function(req, res) {
    console.log("like request was: " + JSON.stringify(req.body));
    var messageId = req.body.uid;
    var messageContent = req.body.content;
    var discordId = req.body.discordId;
    res.end("{'status':'ok'}")
    var channel = client.channels.cache.get(postChannel);
    var findMsg = await findMessage(messageId, discordId);

    if (findMsg) {
        var reactMsg = await channel.messages.fetch(findMsg);
        reactMsg.react('❤'); //heart emoji
    }

});

webapp.post('/edit', async function(req, res) {
    console.log("edit request was: " + JSON.stringify(req.body));
    var messageId = req.body.uid;
    var sender = req.body.sender;
    var newContent = convertEmoticons(req.body.newcontent);
    var oldContent = req.body.oldcontent;
    var discordId = req.body.discordId;
    res.end("{'status':'ok'}")
    var channel = client.channels.cache.get(postChannel);
    var findMsg = await findMessage(messageId, discordId);
    if (findMsg) {
        var editMsg = await channel.messages.fetch(findMsg);
        editMsg.edit("**" + sender + "**: " + newContent);
    }

});

//Discord client -- this is the main bot code
//  It needs to be able to reach the Internet
client.on('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});
client.login(botToken);

client.on('messageCreate', msg => { //new message received in Discord
    var user = msg.author;
    console.log(msg.id + " is a new message from: " + user.tag + ", in channel:" + msg.channel.id + " user was bot: " + user.bot);
    if (msg.channel.id == listenChannel || listenChannel == "*") {
        if (user.bot && allowedBots.indexOf(user.id) == -1) {
            console.log("User was a bot with id: " + user.id + " which is not in allowed list. Message will not be posted to simplechat.");
            return;
        }
        if (!user.system) {
            var msgContent = msg.cleanContent;

            try {
                if (msg.attachments) {
                    var attachments = [];
                    console.log("Incoming message has attachments");
                    for (const thisattach of msg.attachments) {
                        var attachdata = thisattach[1];
                        var nameparts = attachdata.name.split(".");
                        var extension = nameparts[nameparts.length - 1];
                        var attachment = {
                            "filename": "rs-" + attachdata.id + "." + extension,
                            "extension": extension,
                            "height": attachdata.height,
                            "width": attachdata.width,
                        }
                        if (safeExtensions.includes(extension.toLowerCase())) {
                            attachments.push(attachment);
                            downloadAttachment(attachdata.url, attachdata.id + "." + extension)
                        }
                    }
                }
            } catch (ex) {
                console.warn("An error occurred processing an attachment, media type may be unsupported and was ignored.")
            }
            console.log("Posting to simplechat file " + msgContent);
            var newMessage = {
                "uid": msg.id,
                "senderKey": msg.nonce,
                "sender": user.username,
                "message": convertEmojis(msgContent),
                "timestamp": formatDateTime(msg.createdAt),
                "postedFrom": "discord",
                "discordId": msg.id
            }
            if (attachments && attachments.length > 0)
                newMessage.attachments = attachments;
            console.log("Posting: " + JSON.stringify(newMessage) + " to " + dataFile);

            fs.readFile(dataFile, function(err, data) {
                if (data) {
                    var json = JSON.parse(data);
                    if (json) {
                        json.messages.push(newMessage);
                        while (json.messages.length > config.maxChatLength)
                            json.messages.shift();
                        fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                            if (err)
                                console.log("Error writing file: " + err);
                        });
                        console.log("Chat log has " + json.messages.length + " messages.");
                    }
                }
            });

            if (msg.reference) {
                console.log("Message " + msg.id + " was a reply to: " + msg.reference.messageId);
                var replyToId = msg.reference.messageId;
                setTimeout(function() {
                    appendReply(newMessage.message, msg.id, replyToId);
                }, 1000);
            }
        }
    }
});

client.on('messageReactionAdd', (reaction, user) => { //message reaction added in Discord
    console.log("A reaction happened on: " + reaction.message.id + " user was bot: " + user.bot);
    if (!user.bot) {
        fs.exists(dataFile, (exists) => {
            fs.readFile(dataFile, function(err, data) {
                if (data) {
                    var json = JSON.parse(data);
                    if (json) {
                        for (var m = 0; m < json.messages.length; m++) {
                            if (json.messages[m].uid == reaction.message.id || json.messages[m].discordId == reaction.message.id) {
                                console.log("Found chatlog message to like!");
                                if (!json.messages[m].likes)
                                    json.messages[m].likes = 1;
                                else
                                    json.messages[m].likes++;
                            }
                        }
                        fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                            if (err)
                                console.log("Error writing file: " + err);
                        });
                    }
                }
            });
        });
    }
});

client.on('messageUpdate', (oldMsg, newMsg) => { //message edited in Discord
    console.log("An edit happened on: " + oldMsg.id + ", user was bot: " + newMsg.author.bot);
    var discordMsg = newMsg.cleanContent;
    discordMsg = discordMsg.split("**: ");
    discordMsg = discordMsg[discordMsg.length - 1];

    if (newMsg.author.bot && allowedBots.indexOf(newMsg.author.id) == -1) {
        console.log("User was a bot with id: " + newMsg.author.id + " which is not in allowed list. Message will not be edited in simplechat.");
        return;
    }
    updateMessage(oldMsg.id, discordMsg);
});

client.on('messageDelete', function(msg) { //message deleted in Discord
    console.log(msg.id + " was deleted in Discord, removing from chatlog");
    fs.readFile(dataFile, function(err, data) {
        if (data) {
            var json = JSON.parse(data);
            if (json) {
                var originalLength = json.messages.length;
                json.messages = json.messages.filter(function(m) {
                    return m.uid != msg.id && m.discordId != msg.id;
                });
                if (json.messages.length < originalLength) {
                    fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                        if (err)
                            console.log("Error writing file: " + err);
                    });
                    console.log("Removed deleted message from chatlog.");
                } else {
                    console.log("Deleted Discord message was not found in chatlog.");
                }
            }
        }
    });
});

function updateMessage(oldMsgId, discordMsg) {
    console.log("looking for message to update " + oldMsgId);
    fs.exists(dataFile, (exists) => {
        fs.readFile(dataFile, function(err, data) {
            if (data) {
                var json = JSON.parse(data);
                if (json) {
                    for (var m = 0; m < json.messages.length; m++) {
                        if (json.messages[m].uid == oldMsgId || json.messages[m].discordId == oldMsgId) {
                            json.messages[m].message = convertEmojis(discordMsg);
                        }
                    }
                    fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                        if (err)
                            console.log("Error writing file: " + err);
                    });
                }
            }
        });
    });
}

//Helper functions

async function appendReply(cleanContent, discordMessageId, replyToId) {
    console.log("I should async edit a message with id " + discordMessageId + " as a reply to " + replyToId);
    var findOldMsg = await findDiscordMessage(replyToId);
    if (findOldMsg) {
        console.log("i found the old message on Discord: " + findOldMsg.cleanContent);
        var msgWithReplyContent = cleanContent + "<br><i>in reply to: " + findOldMsg.cleanContent + "</i>";
        console.log("I should append " + findOldMsg.cleanContent + " to " + discordMessageId);
        updateMessage(discordMessageId, msgWithReplyContent);
    }
}

function downloadAttachment(url, filename) {
    var dest = cachePath
    var file = fs.createWriteStream(dest + filename);
    var request = https.get(url, function(response) {
            response.pipe(file);
            file.on('finish', function() {
            file.close();  // close() is async, call cb after close completes.
            const path = dest + filename;
            if (filename.indexOf(".jpg") != -1) {
                console.log('Checking image rotation');
                const options = {
                    quality: 8,
                    jpegjsMaxResolutionInMP: 1234,
                  }
                jo.rotate(path, options, (error, buffer, orientation, dimensions, quality) => {
                    if (error) {
                      console.log('An error occurred when rotating the file: ' + error.message)
                    } else {
                        console.log(`Orientation was ${orientation}`)
                        console.log(`Dimensions after rotation: ${dimensions.width}x${dimensions.height}`)
                        console.log(`Quality: ${quality}`)
                        fs.writeFile(path, buffer, (err) => {
                            if (err)
                                console.log('Error saving rotated image: ' + err);
                            else
                                console.log('Rotation saved');
                        });
                    }
                  })
            }
            console.log('Resizing image');
            sharp(path)
                .resize(1024, 768, {
                    fit: 'inside'
                })
                .toFile(dest + "rs-" + filename)
                .then(() => {
                    console.log('Resize done');
            });
        });
    }).on('error', function(err) { // Handle errors
        fs.unlink(dest + filename, () => {});
    });
};


var findMessage = async function(messageId, discordId) {
    if (listenChannel == "*") {
        console.warn("Warning: listening to all channels limits responses to only the post channel...");
    }
    console.log("Looking for message: " + messageId + "/" + discordId + " in channel: " + listenChannel);
    var channel = client.channels.cache.get(postChannel);
    var findMsg = await channel.messages.fetch({ limit: 100 }).then(messages => {
        for (var message of messages) {
            var checkMessage = message[1];
            if (checkMessage.id == messageId || checkMessage.id == discordId) {
                console.log("Found matching message in Discord: " + checkMessage.id);
                return checkMessage.id;
            }
        }
    });
    return findMsg;
}

var findDiscordMessage = async function(messageId) {
    if (listenChannel == "*") {
        console.warn("Warning: listening to all channels limits responses to only the post channel...");
    }
    console.log("Looking for Discord message: " + messageId + " in channel: " + listenChannel);
    var channel = client.channels.cache.get(postChannel);
    var findMsg = await channel.messages.fetch(messageId).then(message => {
        if (message)
            return message;
    });
    return findMsg;
}

function discordIDToSimpleChat(uid, did) {
    console.log("Append DiscordID " + did + " to simplechat uid: " + uid);
    fs.readFile(dataFile, function(err, data) {
        if (data) {
            var json = JSON.parse(data);
            if (json) {
                for (var m = 0; m < json.messages.length; m++) {
                    if (json.messages[m].uid == uid)
                        json.messages[m].discordId = did;
                }
                fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                    if (err)
                        console.log("Error writing file: " + err);
                });
            }
        }
    });
}

function convertWosaLinks(message) { //change default wosa link to one Discord will render
    message = message.replace("wosa.link/download.php?", "wosa.link/image.php?");
    return message;
}

function convertEmoticons(message) { //turn a webOS emoticon into an emoji
    for (var e = 0; e < emojiTranslate.length; e++) {
        message = message.replaceAll(emojiTranslate[e].webOS, emojiTranslate[e].emoji);
    }
    return message;
}

function convertEmojis(message) { //turn an emoji into a webOS emoticon
    for (var e = 0; e < emojiTranslate.length; e++) {
        message = message.replaceAll(emojiTranslate[e].emoji, emojiTranslate[e].webOS);
    }
    return message;
}

function formatDateTime(currentDateTime) {
    function appendLeadingZeroes(n) {
        if (n <= 9) {
            return "0" + n;
        }
        return n
    }
    currentDateTime = currentDateTime.getFullYear() + "-" + appendLeadingZeroes(currentDateTime.getMonth() + 1) + "-" + appendLeadingZeroes(currentDateTime.getDate()) + " " + appendLeadingZeroes(currentDateTime.getHours()) + ":" + appendLeadingZeroes(currentDateTime.getMinutes()) + ":" + appendLeadingZeroes(currentDateTime.getSeconds());
    return currentDateTime;
}

var emojiTranslate = [
    { "emoji": "😉", "webOS": ";)" },
    { "emoji": "😨", "webOS": ":-!" },
    { "emoji": "😇", "webOS": "O:)" },
    { "emoji": "🙂", "webOS": ":)" },
    { "emoji": "😈", "webOS": ">:-)" },
    { "emoji": "😕", "webOS": ":/ " },
    { "emoji": "🤢", "webOS": ":@" },
    { "emoji": "😜", "webOS": "o_O" },
    { "emoji": "😡", "webOS": ">:(" },
    { "emoji": "☹",  "webOS": ":(" },
    { "emoji": "😳", "webOS": ":[" },
    { "emoji": "😮", "webOS": ":O" },
    { "emoji": "😎", "webOS": "B-)" },
    { "emoji": "😀", "webOS": ":D" },
    { "emoji": "😘", "webOS": ":-*" },
    { "emoji": "❤",  "webOS": "<3" },
    { "emoji": "😛", "webOS": ":P" },
    { "emoji": "😐", "webOS": ":|" },
    { "emoji": "😵", "webOS": "X(" },
    { "emoji": "😄", "webOS": "^_^" },
    { "emoji": "😢", "webOS": ":'(" }
];
