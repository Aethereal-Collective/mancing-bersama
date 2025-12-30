import bs58 from "bs58";
import readline from "readline";

function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function convertSession(privatePkcs8B64, publicRawB64) {
    const privPkcs8 = base64ToUint8Array(privatePkcs8B64);
    const pubRaw = base64ToUint8Array(publicRawB64);
    const privSeed = privPkcs8.slice(16, 48);
    const fullKeypair = new Uint8Array(64);
    fullKeypair.set(privSeed, 0);
    fullKeypair.set(pubRaw, 32);

    return {
        sessionKeyB58: bs58.encode(fullKeypair),
        publicKeyB58: bs58.encode(pubRaw),
        length: fullKeypair.length
    };
}

function showInstructions() {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    FOGO SESSION KEY CONVERTER                    ║
╚══════════════════════════════════════════════════════════════════╝

STEP 1: Open Fogo Fishing in your browser
STEP 2: Open DevTools (F12) → Console tab
STEP 3: Paste the following script to install the hook:

────────────────────────────────────────────────────────────────────
const _gen = crypto.subtle.generateKey.bind(crypto.subtle);
crypto.subtle.generateKey = async (algo, extractable, usages) => {
  console.log("🔓 Making key extractable!");
  return _gen(algo, true, usages);
};
indexedDB.deleteDatabase("sessionsdb");
console.log("✅ Hook ready! Refresh the page now...");
────────────────────────────────────────────────────────────────────

STEP 4: Refresh the Fogo page
STEP 5: Cast once in the game
STEP 6: Run the extract script in Console:

────────────────────────────────────────────────────────────────────
(async () => {
  const request = indexedDB.open("sessionsdb");
  request.onsuccess = async (e) => {
    const db = e.target.result;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = async (ev) => {
      const item = ev.target.result[0];
      if (!item || !item.sessionKey) {
        console.log("❌ No session found! Cast first.");
        return;
      }
      const privPkcs8 = await crypto.subtle.exportKey("pkcs8", item.sessionKey.privateKey);
      const pubRaw = await crypto.subtle.exportKey("raw", item.sessionKey.publicKey);
      console.log("\\n✅ COPY THESE VALUES:\\n");
      console.log("PRIVATE_PKCS8_B64:", btoa(String.fromCharCode(...new Uint8Array(privPkcs8))));
      console.log("PUBLIC_RAW_B64:", btoa(String.fromCharCode(...new Uint8Array(pubRaw))));
    };
  };
})();
────────────────────────────────────────────────────────────────────

STEP 7: Copy PRIVATE_PKCS8_B64 and PUBLIC_RAW_B64 from Console
STEP 8: Paste them below
`);
}

async function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function main() {
    const args = process.argv.slice(2);

    let privatePkcs8B64, publicRawB64;

    if (args.length >= 2) {
        // Mode: command line arguments
        privatePkcs8B64 = args[0];
        publicRawB64 = args[1];
    } else {
        // Mode: interactive
        showInstructions();

        privatePkcs8B64 = await prompt("PRIVATE_PKCS8_B64: ");
        publicRawB64 = await prompt("PUBLIC_RAW_B64: ");
    }

    if (!privatePkcs8B64 || !publicRawB64) {
        console.log("\n❌ Error: Both keys are required!");
        process.exit(1);
    }

    try {
        const result = convertSession(privatePkcs8B64, publicRawB64);

        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      SESSION KEY CONVERTED                       ║
╚══════════════════════════════════════════════════════════════════╝

PUBLIC_KEY:      ${result.publicKeyB58}

SESSION_KEY_B58: ${result.sessionKeyB58}

Length: ${result.length} bytes (should be 64)

────────────────────────────────────────────────────────────────────
Copy SESSION_KEY_B58 to your .env file
────────────────────────────────────────────────────────────────────
`);
    } catch (err) {
        console.error("\n❌ Error:", err.message);
        process.exit(1);
    }
}

main();
