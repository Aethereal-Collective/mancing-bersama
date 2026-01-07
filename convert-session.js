import bs58 from "bs58";
import nacl from "tweetnacl";
import readline from "readline";

function base64ToUint8Array(base64) {
    const binaryString = Buffer.from(base64, 'base64');
    return new Uint8Array(binaryString);
}

function convertSession(privatePkcs8B64) {
    const privPkcs8 = base64ToUint8Array(privatePkcs8B64);

    // PKCS8 format for Ed25519: 48 bytes total
    // Bytes 0-15: ASN.1 header
    // Bytes 16-47: 32-byte seed
    if (privPkcs8.length !== 48) {
        throw new Error(`Invalid PKCS8 length: ${privPkcs8.length} (expected 48)`);
    }

    const seed = privPkcs8.slice(16, 48);

    // Use tweetnacl to derive proper Ed25519 keypair from seed
    const keypair = nacl.sign.keyPair.fromSeed(seed);

    return {
        sessionKeyB58: bs58.encode(keypair.secretKey),
        publicKeyB58: bs58.encode(keypair.publicKey),
        length: keypair.secretKey.length
    };
}

function showInstructions() {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    FOGO SESSION KEY CONVERTER                    ║
╚══════════════════════════════════════════════════════════════════╝

METHOD 1: TAMPERMONKEY (Recommended)
────────────────────────────────────────────────────────────────────
1. Install Tampermonkey browser extension
2. Create new script with this code:

// ==UserScript==
// @name         Fogo Session Extractor
// @match        *://*fogo*/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    indexedDB.deleteDatabase("sessionsdb");
    const target = unsafeWindow.crypto || window.crypto;
    const orig = target.subtle.generateKey.bind(target.subtle);
    
    target.subtle.generateKey = async function(algo, ext, usages) {
        console.log("🔓 INTERCEPTED!");
        const result = await orig(algo, true, usages);
        if (result.privateKey) {
            const priv = await target.subtle.exportKey('pkcs8', result.privateKey);
            const pub = await target.subtle.exportKey('raw', result.publicKey);
            console.log('====================================');
            console.log('PRIVATE_PKCS8_B64:', btoa(String.fromCharCode(...new Uint8Array(priv))));
            console.log('PUBLIC_RAW_B64:', btoa(String.fromCharCode(...new Uint8Array(pub))));
            console.log('====================================');
        }
        return result;
    };
})();

3. Open Fogo, login, cast once
4. Check Console for PRIVATE_PKCS8_B64
5. Run: node convert-session.js <PRIVATE_PKCS8_B64>

────────────────────────────────────────────────────────────────────

METHOD 2: MANUAL CONSOLE (May not work if key not extractable)
────────────────────────────────────────────────────────────────────
1. Open DevTools (F12) → Console
2. Paste this hook FIRST:

const _gen = crypto.subtle.generateKey.bind(crypto.subtle);
crypto.subtle.generateKey = async (algo, extractable, usages) => {
  return _gen(algo, true, usages);
};
indexedDB.deleteDatabase("sessionsdb");

3. Refresh page, cast once
4. Then run extract script to get keys

────────────────────────────────────────────────────────────────────
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

    let privatePkcs8B64;

    if (args.length >= 1) {
        // Mode: command line arguments (only need private key now)
        privatePkcs8B64 = args[0];
    } else {
        // Mode: interactive
        showInstructions();
        privatePkcs8B64 = await prompt("PRIVATE_PKCS8_B64: ");
    }

    if (!privatePkcs8B64) {
        console.log("\n❌ Error: Private key is required!");
        process.exit(1);
    }

    try {
        const result = convertSession(privatePkcs8B64);

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
