import bs58 from "bs58";

const PRIVATE_PKCS8_B64 = "SESSION_KEY_PKSC8_PRIVATE";
const PUBLIC_RAW_B64 = "SESSION_KEY_PUBLIC_RAW";

function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

try {
    const privPkcs8 = base64ToUint8Array(PRIVATE_PKCS8_B64);
    const pubRaw = base64ToUint8Array(PUBLIC_RAW_B64);
    const privSeed = privPkcs8.slice(16, 48);
    const fullKeypair = new Uint8Array(64);
    fullKeypair.set(privSeed, 0);
    fullKeypair.set(pubRaw, 32);

    const SESSION_KEY_B58 = bs58.encode(fullKeypair);
    const PUBLIC_KEY_B58 = bs58.encode(pubRaw);

    console.log("============================================================");
    console.log("SESSION KEY CONVERTED");
    console.log("============================================================");
    console.log("");
    console.log("PUBLIC KEY:", PUBLIC_KEY_B58);
    console.log("");
    console.log("SESSION_KEY_B58:", SESSION_KEY_B58);
    console.log("");
    console.log("Length check:", fullKeypair.length, "bytes (should be 64)");

} catch (err) {
    console.error("Error:", err.message);
}
