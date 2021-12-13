#!/bin/bash
#cleanup cache (older than 60 days)
find /var/www/chat/cache/*.* -mtime +60 -exec rm -f {} \;

#start the bot
/your/path/to/node /opt/simplechat-discordbot/index.js