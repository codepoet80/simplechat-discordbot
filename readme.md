This bot can be added to a Discord server to copy messages to and from your local chat. SimpleChat will try to communicate with it on the port you set. It communicates to SimpleChat by writing directly to the SimpleChat chatlog file.

You can run this from anywhere, but its not safe to run this folder inside a web directory unless you restrict access to localhost.

# Sample .htaccess

```
Order Deny,Allow
Deny from all
Allow from 127.0.0.1
```

# Install
* Setup a Discord app and add to your server: https://www.howtogeek.com/364225/how-to-make-your-own-discord-bot/
* Install Node v12 or better
* `npm install`
* copy config-example.json to config.json
* change config.json to your liking
* Optionally set a startup script like in the example