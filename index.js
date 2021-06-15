const config = require('./config.json');
const express = require('express');
const fs = require('fs');

var dataFile = config.simpleChatDataFile;

//Web server config
const webapp = express();
webapp.use(express.json());
var webPort = config.webPort;

//Discord config
const Discord = require('discord.js');
const client = new Discord.Client();
var appId = config.discordAppId;
var listenChannel = config.discordListenChannelId;
var postChannel = config.discordPostChannelId;

//Web server to receive instructions on
//  This should usually be accessible only to local host and is used to integrate
//  Other services (like the SimpleChat service) with the bot
var server = webapp.listen(webPort, function() {
    var host = server.address().address;
    var port = server.address().port;
    console.log("🤖 Listening for messages to send to Discord at http://%s:%s", host, port);
});

webapp.post('/post', function(req, res) {
    console.log("post request was: " + JSON.stringify(req.body));
    var message = req.body.content;
    message = convertEmoticons(message);
    res.end("{'status':'ok'}")
    var channel = client.channels.cache.get(postChannel);
    channel.send("**" + req.body.username + "**: " + message).then(message => {
        console.log("Sent message id: " + message.id);
        //update chatlog.json to include ID from discord
        discordIDToSimpleChat(req.body.uid, message.id);
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
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});
client.login(appId);

client.on('message', msg => { //new message received in Discord
    console.log(msg.id + " is a new message from: " + msg.author + ", in channel:" + msg.channel);
    if (msg.channel == listenChannel || listenChannel == "*") {
        var user = new Discord.User(client, msg.author);
        if (!user.bot && !user.system) {
            console.log("posting to simplechat file");
            var newMessage = {
                "uid": msg.id,
                "senderKey": msg.nonce,
                "sender": user.username,
                "message": convertEmojis(msg.cleanContent),
                "timestamp": formatDateTime(msg.createdAt),
                "postedFrom": "discord",
                "discordId": msg.id
            }
            console.log("Posting: " + JSON.stringify(newMessage));

            fs.readFile(dataFile, function(err, data) {
                if (data) {
                    var json = JSON.parse(data);
                    if (json) {
                        json.messages.push(newMessage);
                        while (json.messages.length > config.maxChatLength)
                            json.messages.shift();
                        fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                            if (err)
                                console.log("error writing file: " + err);
                        });
                        console.log("Chat log has " + json.messages.length + " messages.");
                    }
                }
            });
        }
    }
});

client.on('messageReactionAdd', (reaction, user) => { //message reaction added in Discord
    console.log("a reaction happened on: " + reaction.message + " user was bot: " + user.bot);
    if (!user.bot) {
        fs.exists(dataFile, (exists) => {
            fs.readFile(dataFile, function(err, data) {
                if (data) {
                    var json = JSON.parse(data);
                    if (json) {
                        for (var m = 0; m < json.messages.length; m++) {
                            if (json.messages[m].uid == reaction.message || json.messages[m].discordId == reaction.message) {
                                console.log("found chatlog message to like!");
                                if (!json.messages[m].likes)
                                    json.messages[m].likes = 1;
                                else
                                    json.messages[m].likes++;
                            }
                        }
                        fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                            if (err)
                                console.log("error writing file: " + err);
                        });
                    }
                }
            });
        });
    }
});

client.on('messageUpdate', (oldMsg, newMsg) => { //message edited in Discord
    console.log("an edit happened on: " + oldMsg + ", user was bot: " + newMsg.author.bot);
    var discordMsg = newMsg.cleanContent;
    discordMsg = discordMsg.split("**: ");
    discordMsg = discordMsg[discordMsg.length - 1];

    if (!newMsg.author.bot) {
        fs.exists(dataFile, (exists) => {
            fs.readFile(dataFile, function(err, data) {
                if (data) {
                    var json = JSON.parse(data);
                    if (json) {
                        for (var m = 0; m < json.messages.length; m++) {
                            if (json.messages[m].uid == oldMsg.id || json.messages[m].discordId == oldMsg.id) {
                                json.messages[m].message = convertEmojis(discordMsg);
                            }
                        }
                        fs.writeFile(dataFile, JSON.stringify(json, null, 4), (err) => {
                            if (err)
                                console.log("error writing file: " + err);
                        });
                    }
                }
            });
        });
    }
});

//Helper functions

var findMessage = async function(messageId, discordId) {
    if (listenChannel == "*") {
        console.log("warning: listening to all channels limits responses to only the post channel...");
    }
    console.log("looking for message: " + messageId + "/" + discordId + " in channel: " + listenChannel);
    var channel = client.channels.cache.get(postChannel);
    var findMsg = await channel.messages.fetch({ limit: 100 }).then(messages => {
        for (message of messages) {
            var checkMessage = message[1];
            if (checkMessage.id == messageId || checkMessage.id == discordId) {
                console.log("Found matching message in Discord: " + checkMessage.id);
                return checkMessage.id;
            }
        }
    });
    return findMsg;
}

function discordIDToSimpleChat(uid, did) {
    console.log("append discordid " + did + " to simplechat uid: " + uid);
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
                        console.log("error writing file: " + err);
                });
            }
        }
    });
}

function convertEmoticons(message) { //turn an emoji into a webOS emoticon
    for (var e = 0; e < emojiTranslate.length; e++) {
        if (message.indexOf(emojiTranslate[e].webOS) != -1) {
            message = message.replace(emojiTranslate[e].webOS, emojiTranslate[e].emoji);
        }
    }
    return message;
}

function convertEmojis(message) { //turn a webOS emoticon into an emoji
    for (var e = 0; e < emojiTranslate.length; e++) {
        if (message.indexOf(emojiTranslate[e].emoji) != -1) {
            message = message.replace(emojiTranslate[e].emoji, emojiTranslate[e].webOS);
        }
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
    { "emoji": "😦", "webOS": ":-!" },
    { "emoji": "😦", "webOS": ":-!" },
    { "emoji": "😇", "webOS": "O:)" },
    { "emoji": "🙂", "webOS": ":)" },
    { "emoji": "😈", "webOS": ">:-)" },
    { "emoji": "😕", "webOS": ":/ " },
    { "emoji": "🤢", "webOS": ":@" },
    { "emoji": "😜", "webOS": "o_O" },
    { "emoji": "😡", "webOS": ">:(" },
    { "emoji": "😠", "webOS": ">:(" },
    { "emoji": "☹", "webOS": ":(" },
    { "emoji": "😳", "webOS": ":["},
    { "emoji": "😮", "webOS": ":O" },
    { "emoji": "🙁", "webOS": ":(" },
    { "emoji": "😎", "webOS": "B-)" },
    { "emoji": "😀", "webOS": ":D" },
    { "emoji": "😃", "webOS": ":D" },
    { "emoji": "😘", "webOS": ":-*" },
    { "emoji": "😗", "webOS": ":-*" },
    { "emoji": "😚", "webOS": ":-*" },
    { "emoji": "😙", "webOS": ":-*" },
    { "emoji": "❤", "webOS": "<3" },
    { "emoji": "😛", "webOS": ":P" },
    { "emoji": "😐", "webOS": ":|" },
    { "emoji": "😵", "webOS": "X(" },
    { "emoji": "😄", "webOS": "^_^" },
    { "emoji": "😁", "webOS": "^_^" },
    { "emoji": "😢", "webOS": ":'(" },
    { "emoji": "😭", "webOS": ":'(" }
];
