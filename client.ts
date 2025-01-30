const endpoint = "https://discord.com/api/webhooks/"
const send_file = async (blob: Blob, name: string) => {
  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({}));
  formData.append('file', blob, name);
  const response = await fetch(location.protocol + "//" + location.host + "/send", {
      method: 'POST',
      body: formData
  });
  return await response.json();
}

(document.getElementById("fileUpload") as HTMLInputElement).addEventListener("change", async e => {
  try {
    const file = (e.target as HTMLInputElement).files![0]
    const iv = crypto.getRandomValues(new Uint8Array(16))
    const key = await crypto.subtle.generateKey({'name': 'AES-CBC', 'length': 256}, true, ['encrypt', 'decrypt']);
    const encrypted = new Blob([new Uint8Array(await crypto.subtle.encrypt({ 'name': 'AES-CBC', iv}, key!, await file.arrayBuffer()))])
    const parts = []
    document.getElementById("percentage")!.textContent = "Starting...";
    document.getElementById("shareLinks")!.hidden = true;
    for (let i = 0; i < encrypted.size; i += 1000 * 1000 * 9) {
        console.log(i)
        const res = await send_file(encrypted.slice(i, i + 1000 * 1000 * 9), "data.bin")
        parts.push(res.id)
        document.getElementById("percentage")!.textContent = i / encrypted.size * 100 + "%"
    }
    const deletionCode = (Math.random() + "").replace("0.", "")
    const message = await send_file(new Blob([JSON.stringify({
        type: "file",
        name: window.btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.encrypt({ 'name': 'AES-CBC', iv}, key!, (new TextEncoder()).encode(file.name))))),
        parts: parts,
        iv: [...iv],
        mimeType: file.type,
        deletionCode
    })]), "file.json");
    console.log(message);
    document.getElementById("shareLinks")!.hidden = false;
    const contents = window.btoa(JSON.stringify({
      fileId: message.id,
      key: await crypto.subtle.exportKey("jwk", key)
    })).replace(/=/g, "");
    document.getElementById("percentage")!.textContent = "Finished!";
    (document.getElementById("indirectURL") as HTMLAnchorElement).href = location.origin + "/file/" + contents
    document.getElementById("indirectURL")!.textContent = (document.getElementById("indirectURL") as HTMLAnchorElement).href;
    (document.getElementById("directURL") as HTMLAnchorElement).href = location.origin + "/direct/" + contents
    document.getElementById("directURL")!.textContent = (document.getElementById("directURL") as HTMLAnchorElement).href;
    (document.getElementById("deleteURL") as HTMLAnchorElement).href = location.origin + "/delete/" + contents + "/" + deletionCode
    document.getElementById("deleteURL")!.textContent = (document.getElementById("deleteURL") as HTMLAnchorElement).href
  } catch (e) {
    document.getElementById("percentage")!.textContent = "An error occured!";
    throw e;
  }
});

document.getElementById("uploadLabel")!.addEventListener("keyup", e => {
  if (e.key === 'Enter') {
    document.getElementById("fileUpload")!.click();
  }
})

const retrieve = async (fileId: string, keyObject: any) => {
  const metadataURL = (await (await fetch("/retrieve/" + fileId)).json()).attachments[0].url
  const metadata = await (await fetch("/cdn-proxy?url=" + encodeURIComponent(metadataURL))).json()
  console.log(metadata)
  document.getElementById("percentage")!.textContent = "Starting...";
  const blobs = []
  for (const [index, partId] of metadata.parts.entries()) {
    const partURL = (await (await fetch("/retrieve/" + partId)).json()).attachments[0].url
    blobs.push(await (await fetch("/cdn-proxy?url=" + encodeURIComponent(partURL))).blob())
    document.getElementById("percentage")!.textContent = (index + 1) / metadata.parts.length * 100 + "%";
  }
  const encrypted = new Blob(blobs)
  const key = await crypto.subtle.importKey("jwk", keyObject, {'name': 'AES-CBC', 'length': 256}, true, ['encrypt', 'decrypt'])
  const blob = new Blob([new Uint8Array(await crypto.subtle.decrypt({ 'name': 'AES-CBC', 'iv': new Uint8Array(metadata.iv)}, key!, await encrypted.arrayBuffer()))])
  const url = URL.createObjectURL(blob)
  const aElem = document.createElement("a")
  aElem.href = url
  aElem.download = (new TextDecoder()).decode(await crypto.subtle.decrypt({ 'name': 'AES-CBC', 'iv': new Uint8Array(metadata.iv)}, key!, Uint8Array.from(window.atob(metadata.name), c => c.charCodeAt(0))))
  aElem.click()
  setTimeout(() => URL.revokeObjectURL(url))
}

if (location.href.includes("/file/")) {
  let data = null;
  try {
    data = JSON.parse(window.atob(location.href.split("/file/")[1].split("/")[0]));
  } catch (e) {
    document.getElementById("percentage")!.textContent = "Not a valid URL!";
    console.error(e);
  }
  try {
    if (data) await retrieve(data.fileId, data.key);
  } catch (e) {
    document.getElementById("percentage")!.textContent = "An error occured!";
    throw e;
  }
};