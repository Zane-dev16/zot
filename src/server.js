const http = require("http");

const server = http.createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("ok");
		return;
	}
	res.writeHead(404, { "content-type": "text/plain" });
	res.end("not found");
});

if (require.main === module) {
	server.listen(3000, () => console.log("zot listening on 3000"));
}

module.exports = server;
