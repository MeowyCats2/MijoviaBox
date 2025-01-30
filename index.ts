import express from "express"
import "express-async-errors"
import bodyParser from "body-parser"
import multer from "multer"
import "./build.ts"

const multerParser = multer()

const app = express()

const port = 3000

app.set("query parser", "extended")
app.use(
  express.raw({ inflate: true, limit: '50mb', type: () => true })
);

app.use("/static", express.static("static"))


const throwOn4xx = async (res: Response) => {
	if (res.status >= 400 && res.status < 500) {
		console.error(res)
		console.error(await res.text())
		console.error((new Error()).stack)
		throw new Error("HTTP Status " + res.status)
	}
	return res
}
let ratelimitBucketReset: number | null = null
const notFoundURLs: string[] = []
const requestQueue: Function[] = []
let processingRequest = false
const mfetch = async (...body: [string, any]) => {
	if (notFoundURLs.includes(body[0])) {
		throw new Error("404")
	}
	if (ratelimitBucketReset && ratelimitBucketReset > Date.now() / 1000) {
		await new Promise(resolve => setTimeout(resolve, (ratelimitBucketReset! - Date.now() / 1000) * 1000))
		if (processingRequest) {
			const {promise, resolve} = Promise.withResolvers();
			requestQueue.push(resolve)
			await promise
		}
		return await mfetch(...body)
	}
	processingRequest = true
  let response: Response | null = null;
  try {
	  response = await fetch(...body);
  } catch (e) {
    console.error(e)
    try {
      response = await fetch(...body)
    } catch (e) {
      response = await fetch(...body)
    }
  }
	console.log(response.headers.get("X-RateLimit-Remaining"))
	if (response.headers.get("X-RateLimit-Remaining") === "0") {
    console.log("Rate limited oh shoot!")
		ratelimitBucketReset = +response.headers.get("X-RateLimit-Reset")!
	}
	if (response.status === 429) {
    console.log("Ok the rate limit is serious now")
		try {
			const data = await response.clone().json()
			if (data.retry_after) {
				await new Promise(resolve => setTimeout(resolve, data.retry_after * 1000))
				return await mfetch(...body)
			}
		} catch (e) {}
		console.log()
	}
	if (response.status === 404) notFoundURLs.push(body[0])
	processingRequest = false
	if (requestQueue.length > 0) requestQueue.shift()!()
	return await throwOn4xx(response)
}

app.get("/", (req, res) => {
  res.sendFile("./static/index.html", {"root": process.cwd()})
})

app.get("/file/:contents", (req, res) => {
  res.sendFile("./static/index.html", {"root": process.cwd()})
})

app.get("/direct/:contents", async (req, res) => {
  let data = null;
  try {
    data = JSON.parse(Buffer.from(req.params.contents, "base64").toString());
  } catch (e) {
    console.error(e);
    return void res.status(400).send("Invalid URL.")
  }
  const metadataURL = (await (await fetch(process.env.webhook + "/messages/" + data.fileId)).json()).attachments[0].url
  const metadata = await (await fetch(metadataURL)).json()
  console.log(metadata)
  const blobs = []
  for (const [index, partId] of metadata.parts.entries()) {
    const partURL = (await (await fetch(process.env.webhook + "/messages/" + partId)).json()).attachments[0].url
    blobs.push(await (await fetch(partURL)).blob())
  }
  const encrypted = new Blob(blobs)
  const key = await crypto.subtle.importKey("jwk", data.key, {'name': 'AES-CBC', 'length': 256}, true, ['encrypt', 'decrypt'])
  const blob = new Blob([new Uint8Array(await crypto.subtle.decrypt({ 'name': 'AES-CBC', 'iv': new Uint8Array(metadata.iv)}, key!, await encrypted.arrayBuffer()))])
  const name = (new TextDecoder()).decode(await crypto.subtle.decrypt({ 'name': 'AES-CBC', 'iv': new Uint8Array(metadata.iv)}, key!, new Uint8Array(Buffer.from(metadata.name, "base64").buffer)))
  res.set("Content-Disposition", `attachment, filename="${name}"`).set("Content-Type", metadata.mimeType === "text/html" || metadata.mimeType === "application/xhtml+xml" ? "text/plain" : metadata.mimeType).send(Buffer.from(await blob.arrayBuffer()))
})

app.get("/delete/:contents/:code", async (req, res) => {
  res.send(`<!DOCTYPE HTML>
<html>
  <head>
    <title>MijoviaBox</title>
    <link rel="stylesheet" href="/static/styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> 
    <meta content="MijoviaBox" property="og:title">
  </head>
  <body>
    <div id="main">
      <h1 id="title">MijoviaBox</h1>
      <p>Are you sure you would like to delete this file?</p>
      <a href="/delete/${req.params.contents}/${req.params.code}/confirm" class="button">Delete</a>
    </div>
  </body>
</html>`)
});

app.get("/delete/:contents/:code/confirm", async (req, res) => {
  let data = null;
  try {
    data = JSON.parse(Buffer.from(req.params.contents, "base64").toString());
  } catch (e) {
    console.error(e);
    return void res.status(400).send("Invalid URL.")
  }
  const metadataURL = (await (await fetch(process.env.webhook + "/messages/" + data.fileId)).json()).attachments[0].url
  const metadata = await (await fetch(metadataURL)).json()
  console.log(metadata)
  if (metadata.deletionCode !== req.params.code) return void res.status(400).send("Invalid deletion code.")
  for (const partId of metadata.parts) {
    console.log(await (await fetch(process.env.webhook + "/messages/" + partId, {
      method: "DELETE"
    })).json())
  }
  console.log(await (await fetch(process.env.webhook + "/messages/" + data.fileId, {
    method: "DELETE"
  })).json())
  res.send(`<!DOCTYPE HTML>
<html>
  <head>
    <title>MijoviaBox</title>
    <link rel="stylesheet" href="/static/styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> 
    <meta content="MijoviaBox" property="og:title">
  </head>
  <body>
    <div id="main">
      <h1 id="title">MijoviaBox</h1>
      <p>Successfully deleted!</p>
    </div>
  </body>
</html>`)
})

app.post("/send", async (req, res) => {
  const whitelistedKeys = ["user-agent", "accept", "content-type"]
  console.log(Object.entries(req.headers).filter(([key, value]) => whitelistedKeys.includes(key) && typeof value === "string"))
  res.send(await (await mfetch(process.env.webhook + "?wait=true", {
    method: "POST",
    body: new Blob([req.body]),
    headers: Object.entries(req.headers).filter(([key, value]) => whitelistedKeys.includes(key) && typeof value === "string") as [string, string][]
  })).text())
})
app.get("/retrieve/:msgID/", async (req, res) => {
  console.log(req.params)
  res.send(await (await fetch(process.env.webhook + "/messages/" + req.params.msgID)).text())
})
app.get("/cdn-proxy", async (req, res) => {
  if (typeof req.query.url !== "string" || !req.query.url.startsWith("https://cdn.discordapp.com/attachments/")) {
    res.status(400).send("URL must be a CDN url")
  } else {
    res.send(Buffer.from(await (await fetch(req.query.url)).arrayBuffer()))
  }
})
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})