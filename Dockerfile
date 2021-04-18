FROM ubuntu

# Install dependencies and set timezone to UTC
RUN apt-get update -y
RUN apt-get upgrade -y
RUN apt-get install -y tzdata
ENV TZ "UTC"
RUN echo "UTC" > /etc/timezone
RUN dpkg-reconfigure --frontend noninteractive tzdata
RUN apt-get install -y git curl
RUN curl -fsSL https://deb.nodesource.com/setup_15.x | bash -
RUN apt-get install -y nodejs
RUN rm -f /etc/localtime
RUN ln -fs /usr/share/zoneinfo/UCT /etc/localtime

# Download codepoet80's simplechat discordbot and configure it
RUN cd /opt; git clone https://github.com/codepoet80/simplechat-discordbot
RUN mv /opt/simplechat-discordbot/config-example.json /opt/simplechat-discordbot/config.json
RUN mv /opt/simplechat-discordbot/start-example.sh /run.sh

EXPOSE 8001

RUN chmod a+rx /run.sh
CMD ["/bin/bash", "/run.sh"]
