import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import { Buffer } from "buffer";

const RPC_URL = "https://eu.fogo.fluxrpc.com/?key=74a5f926-d7b0-4c72-9a5c-0eaec1a57781";
const PAYMASTER_URL = "https://mainnet.fogo-paymaster.xyz/api/sponsor_and_send?domain=https%3A%2F%2Ffogofishing.com";
const CAPABILITY_URL = "https://cast.fogofishing.com/capability";
const PROGRAM_ID = new PublicKey("SEAyjT1FUx3JyXJnWt5NtjELDwuU9XsoZeZVPVvweU4");

const SESSION_KEY_B58 = "SESSION_KEY";
const OWNER = new PublicKey("SOLANA_ADDRESS");
const DISCORD_WEBHOOK_URL = "DISCORD_WEBHOOK_URL";
const TX_TEMPLATE_B64 = "TX_TEMPLATE";
const CAST_INTERVAL_MS = 3000;
const MAX_CASTS = 0;
const PLAYER_SEED = Buffer.from("player");
const FISH_DECIMALS = 1e6;
const formatFish = (raw) => (raw / FISH_DECIMALS).toFixed(3);
const sessionSecret = bs58.decode(SESSION_KEY_B58);
const SESSION_KEYPAIR = Keypair.fromSecretKey(sessionSecret);
const connection = new Connection(RPC_URL, "confirmed");
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

let totalFishCaught = 0;
let totalCasts = 0;
let successCount = 0;
let failCount = 0;

function parsePlayerState(data) {
  const buf = Buffer.from(data);
  let offset = 8;

  const owner = bs58.encode(buf.slice(offset, offset + 32)); offset += 32;
  const rod_level = buf.readUInt8(offset); offset += 1;
  const boat_tier = buf.readUInt8(offset); offset += 1;
  const bump = buf.readUInt8(offset); offset += 1;
  const cast_count = Number(buf.readBigUInt64LE(offset)); offset += 8;
  const fish_caught_all_time = Number(buf.readBigUInt64LE(offset)); offset += 8;
  const power = Number(buf.readBigUInt64LE(offset)); offset += 8;
  const max_durability = buf.readUInt32LE(offset); offset += 4;
  const current_durability = buf.readUInt32LE(offset); offset += 4;
  const supercast_remaining = buf.readUInt32LE(offset); offset += 4;
  const last_durability_ts = Number(buf.readBigInt64LE(offset)); offset += 8;
  const unprocessed_fish = Number(buf.readBigUInt64LE(offset)); offset += 8;

  return {
    owner,
    rod_level,
    boat_tier,
    cast_count,
    fish_caught_all_time,
    power,
    max_durability,
    current_durability,
    supercast_remaining,
    unprocessed_fish,
  };
}

async function fetchPlayerState() {
  const [playerState] = PublicKey.findProgramAddressSync(
    [PLAYER_SEED, OWNER.toBuffer()],
    PROGRAM_ID
  );
  const acc = await connection.getAccountInfo(playerState);
  if (!acc) throw new Error("Player not found");
  return parsePlayerState(acc.data);
}

async function sendDiscord(content, embed = null) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    const body = { content };
    if (embed) body.embeds = [embed];

    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log("Discord error:", err.message);
  }
}

async function sendCatchReport(fishCaught, state, castNum) {
  if (!DISCORD_WEBHOOK_URL) return;

  const embed = {
    title: "🎣 Fogo Fishing - Cast #" + castNum,
    color: fishCaught > 0 ? 0x00ff00 : 0xff0000,
    fields: [
      { name: "🐟 Fish This Cast", value: `${formatFish(fishCaught)} FISH`, inline: true },
      { name: "📊 Total Session", value: `${formatFish(totalFishCaught)} FISH`, inline: true },
      { name: "🎯 Cast Success", value: `${successCount}/${totalCasts}`, inline: true },
      { name: "⚡ Power", value: `${state.power.toLocaleString()}`, inline: true },
      { name: "🔧 Durability", value: `${state.current_durability}/${state.max_durability}`, inline: true },
      { name: "🎣 Rod Level", value: `${state.rod_level}`, inline: true },
      { name: "🚣 Boat Tier", value: `${state.boat_tier}`, inline: true },
      { name: "📦 Unprocessed", value: `${formatFish(state.unprocessed_fish)} FISH`, inline: true },
      { name: "🏆 All-time Fish", value: `${formatFish(state.fish_caught_all_time)} FISH`, inline: true },
    ],
    footer: { text: `aether | Wallet: ${OWNER.toBase58().slice(0, 8)}...` },
    timestamp: new Date().toISOString(),
  };

  await sendDiscord("", embed);
}

async function fetchCapability() {
  const res = await fetch(CAPABILITY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: OWNER.toBase58(),
      requested_modes: 3,
      program_id: PROGRAM_ID.toBase58(),
    }),
  });
  if (!res.ok) throw new Error("Capability API error");
  const json = await res.json();
  return {
    message: Buffer.from(json.message_b64, "base64"),
    signature: Buffer.from(json.signature_b64, "base64"),
  };
}

async function buildTx(nonce, cap) {
  const tx = VersionedTransaction.deserialize(Buffer.from(TX_TEMPLATE_B64, "base64"));

  const { blockhash } = await connection.getLatestBlockhash();
  tx.message.recentBlockhash = blockhash;

  const ed25519Ix = tx.message.compiledInstructions[1];
  const oldData = Buffer.from(ed25519Ix.data);
  const newData = Buffer.alloc(112 + cap.message.length);
  oldData.copy(newData, 0, 0, 48);
  newData.writeUInt16LE(cap.message.length, 12);
  cap.signature.copy(newData, 48);
  cap.message.copy(newData, 112);
  ed25519Ix.data = newData;

  const castIx = tx.message.compiledInstructions[2];
  const castData = Buffer.from(castIx.data);
  const slot = await connection.getSlot();
  castData.writeBigUInt64LE(BigInt(slot), 40);
  castData.writeBigUInt64LE(BigInt(nonce + 1), 49);
  castIx.data = castData;

  return tx;
}

async function sendTx(tx) {
  const res = await fetch(PAYMASTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: Buffer.from(tx.serialize()).toString("base64") }),
  });
  const text = await res.text();
  if (text.includes('"error"')) throw new Error(text.slice(0, 200));
  const m = text.match(/[1-9A-HJ-NP-Za-km-z]{64,88}/);
  return m ? m[0] : null;
}

async function castOnce() {
  const beforeState = await fetchPlayerState();
  const cap = await fetchCapability();
  const tx = await buildTx(beforeState.cast_count, cap);

  tx.sign([SESSION_KEYPAIR]);
  const sig = await sendTx(tx);
  if (!sig) return { success: false, fishCaught: 0, state: beforeState };

  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const afterState = await fetchPlayerState();
    if (afterState.cast_count > beforeState.cast_count) {
      const fishCaught = afterState.fish_caught_all_time - beforeState.fish_caught_all_time;
      return { success: true, fishCaught, state: afterState };
    }
  }

  return { success: false, fishCaught: 0, state: beforeState };
}

async function autoLoop() {
  log("🎣 FOGO FISHING BOT STARTED");
  log("Session:", SESSION_KEYPAIR.publicKey.toBase58());
  log("Owner:", OWNER.toBase58());
  log("Interval:", CAST_INTERVAL_MS, "ms");
  log("Discord:", DISCORD_WEBHOOK_URL ? "Enabled" : "Disabled");
  log("-------------------------------");

  if (DISCORD_WEBHOOK_URL) {
    await sendDiscord("🎣 **Fogo Fishing Bot Started!**\nWallet: `" + OWNER.toBase58() + "`");
  }

  let castNum = 0;

  while (MAX_CASTS === 0 || castNum < MAX_CASTS) {
    castNum++;
    totalCasts++;

    try {
      log(`Cast #${castNum}...`);
      const result = await castOnce();

      if (result.success) {
        successCount++;
        totalFishCaught += result.fishCaught;

        log(`✅ +${formatFish(result.fishCaught)} FISH | Total: ${formatFish(totalFishCaught)} | ${successCount}/${totalCasts} success`);

        if (result.fishCaught > 0) {
          await sendCatchReport(result.fishCaught, result.state, castNum);
        }
      } else {
        failCount++;
        log(`❌ Failed | ${successCount}/${totalCasts}`);
      }
    } catch (err) {
      failCount++;
      log(`❌ Error: ${err.message}`);
    }

    if (MAX_CASTS === 0 || castNum < MAX_CASTS) {
      await new Promise(r => setTimeout(r, CAST_INTERVAL_MS));
    }
  }

  log("-------------------------------");
  log(`Done! Total fish: ${totalFishCaught}, ${successCount}/${totalCasts} success`);

  if (DISCORD_WEBHOOK_URL) {
    await sendDiscord(`🏁 **Bot Stopped!**\n🐟 Total Fish: ${totalFishCaught}\n✅ Success: ${successCount}/${totalCasts}`);
  }
}

autoLoop().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
