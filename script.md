
# kill port 

lsof -tiTCP:8788 -sTCP:LISTEN | xargs -r kill