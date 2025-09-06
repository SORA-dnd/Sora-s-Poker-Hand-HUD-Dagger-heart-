const MODULE_ID = "poker-hand-hud";
let pokerHandGlobalState = window.pokerHandGlobalState || {};

/* —— Utilities —— */
function hexToRgba(hex, a = 1) {
if (!hex) return `rgba(192,160,96,${a})`;
const h = hex.replace("#", "").trim();
const p = (s) => parseInt(s, 16);
let r, g, b;
if (h.length === 3) { r = p(h[0]+h[0]); g = p(h[1]+h[1]); b = p(h[2]+h[2]); }
else { r = p(h.slice(0,2)); g = p(h.slice(2,4)); b = p(h.slice(4,6)); }
return `rgba(${r},${g},${b},${a})`;
}
function scheduleRebuild(full = false) {
clearTimeout(pokerHandGlobalState._rebuildTimer);
pokerHandGlobalState._rebuildTimer = setTimeout(() => {
if (full) { try { pokerHandGlobalState.cleanup?.(); } catch(e){} displayItemsAsPokerHand(); }
else { rebuildStylesOnly(); updateBookmarkPosition(); restartSparkles(); applyGlobalCollapse(); }
}, 120);
}
// Safely get a setting (uses fallback if not registered, prevents crash)
function getSettingSafe(key, fallback) {
try { return game.settings.get(MODULE_ID, key); } catch(e){ return fallback; }
}

/* —— Sound Effects —— */
const SFX = {
hover: null, click: null, use: null,
load() {
const en = getSettingSafe("sfxEnabled", true);
if (!en) { this.hover=this.click=this.use=null; return; }
const mk = (url) => {
if (!url || url === "path/to/file.ext") return null; // Ignore placeholder
try { const a = new Audio(url); a.volume = getSettingSafe("sfxVolume", 0.85); return a; } catch { return null; }
};
const defHover = "", defClick = "", defUse = "";
this.hover = mk(getSettingSafe("sfxHoverUrl", defHover));
this.click = mk(getSettingSafe("sfxClickUrl", defClick));
this.use = mk(getSettingSafe("sfxUseUrl", defUse));
},
play(aud) { try { if (aud) { aud.currentTime = 0; aud.play().catch(()=>{});} } catch{} }
};

/* —— Use Item and Send to Chat (Multi-system compatible + event pass-through + fallback card; no deprecated 'user' field) —— */
async function useItemAndChat(item, actor = pokerHandGlobalState.actor, evt = null) {
if (!item) return;
const tryCalls = [
async () => item.use?.({}, {event: evt}), // V12+
async () => item.use?.(evt),
async () => item.roll?.({event: evt}) ?? item.roll?.(),
async () => item.toMessage?.({create: true, event: evt}),
async () => item.displayCard?.({create: true, event: evt}),
async () => item.postToChat?.({event: evt}),
async () => item.createChatMessage?.({event: evt}),
];
for (const fn of tryCalls) {
try { const r = await fn?.(); if (r) return r; } catch(e){ console.warn(`[${MODULE_ID}] use pipeline step failed:`, e); }
}
// Fallback: create our own chat message
try {
const name = foundry.utils.escapeHTML(item.name ?? "");
const img = item.img ? `<img src="${item.img}" style="width:36px;height:36px;border-radius:6px;margin-right:8px;object-fit:cover;vertical-align:middle;">` : "";
const desc = item?.system?.description ? `<div style="margin-top:6px">${await TextEditor.enrichHTML(item.system.description.value || item.system.description, {async: true})}</div>` : "";
const content = `<div class="phh-use-card" style="font-family:Signika,sans-serif;line-height:1.45"> <div class="phh-head" style="display:flex;align-items:center;font-weight:700;font-size:14px;"> ${img}<span>Use: ${name}</span> </div> ${desc} </div>`;
return await ChatMessage.create({
speaker: ChatMessage.getSpeaker({ actor }),
type: CONST.CHAT_MESSAGE_TYPES.OTHER,
content,
flags: { [MODULE_ID]: { itemId: item.id, type: item.type || "" } }
});
} catch (e) { console.error(`[${MODULE_ID}] useItemAndChat fallback error`, e); }
}


/* —— Settings Menu —— */
Hooks.on("renderSettingsConfig", (app, html) => {
    if (app.id !== "settings-config") return;

    const root = html[0];
    const moduleTab = root.querySelector(`.tab[data-tab="${MODULE_ID}"]`);
    if (!moduleTab) return;

    // 1. Change color inputs to color pickers
    const COLOR_KEYS = ["hudBgColor", "accentColor", "labelColor", "textColor", "selectedGlowColor", "dotHP", "dotStress", "dotHope", "dotArmor"];
    COLOR_KEYS.forEach(k => {
        const inp = moduleTab.querySelector(`input[name="${MODULE_ID}.${k}"]`);
        if (inp) {
            inp.setAttribute("type", "color");
            if (!inp.value || !inp.value.startsWith("#")) inp.value = "#ffffff";
        }
    });

    // 2. Import/Export functionality
    const worldSettingsHeader = moduleTab.querySelector('h2[id^="world-settings-for"]');
    if (worldSettingsHeader && !moduleTab.querySelector('.phh-import-export-group')) {
        const importExportContainer = document.createElement("div");
        importExportContainer.className = "form-group phh-import-export-group";
        importExportContainer.style.paddingBottom = "10px";
        importExportContainer.style.borderBottom = "1px solid #666";
        importExportContainer.style.marginBottom = "10px";
        importExportContainer.innerHTML = `
            <label style="flex: 1.5;">Configuration Management</label>
            <div class="form-fields" style="gap: 8px;">
                <button type="button" id="phh-export-settings"><i class="fas fa-download"></i> Export Config</button>
                <button type="button" id="phh-import-settings"><i class="fas fa-upload"></i> Import Config</button>
            </div>
        `;
        worldSettingsHeader.after(importExportContainer);

        importExportContainer.querySelector("#phh-export-settings").addEventListener("click", () => {
            const settings = {};
            for (const [key, setting] of game.settings.settings.entries()) {
                if (setting.namespace === MODULE_ID) {
                    settings[key.replace(`${MODULE_ID}.`, "")] = game.settings.get(MODULE_ID, setting.key);
                }
            }
            const content = JSON.stringify(settings, null, 2);
            saveDataToFile(content, "application/json", `poker-hand-hud-settings-${game.world.id}.json`);
            ui.notifications.info("Poker Hand HUD configuration exported.");
        });

        importExportContainer.querySelector("#phh-import-settings").addEventListener("click", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json";
            input.onchange = async (event) => {
                const file = event.target.files[0];
                if (!file) return;
                const content = await file.text();
                try {
                    const settings = JSON.parse(content);
                    let updateCount = 0;
                    for (const [key, value] of Object.entries(settings)) {
                        if (game.settings.settings.has(`${MODULE_ID}.${key}`)) {
                            await game.settings.set(MODULE_ID, key, value);
                            updateCount++;
                        }
                    }
                    ui.notifications.info(`Successfully imported and applied ${updateCount} Poker Hand HUD settings.`);
                    scheduleRebuild(true);
                    app.render(true);
                } catch (e) {
                    console.error(`[${MODULE_ID}] Failed to import settings:`, e);
                    ui.notifications.error("Failed to import settings. Please check if the file format is correct.");
                }
            };
            input.click();
        });
    }
    
    // Add "Advanced Settings" separator
    const firstAdvancedSettingKey = "cardBaseImageUrl"; 
    const firstAdvancedSettingElement = moduleTab.querySelector(`input[name="${MODULE_ID}.${firstAdvancedSettingKey}"]`);
    if (firstAdvancedSettingElement) {
        const formGroup = firstAdvancedSettingElement.closest('.form-group');
        if (formGroup && !formGroup.querySelector('.notes')) {
            const notes = document.createElement('p');
            notes.className = 'notes';
            notes.textContent = 'The following are advanced settings, rarely used.';
            notes.style.flexBasis = '100%';
            notes.style.marginTop = '-5px';
            notes.style.marginBottom = '8px';
            notes.style.borderTop = '1px solid #666';
            notes.style.paddingTop = '8px';
            formGroup.before(notes);
        }
    }
});


/* —— Left Bookmark Position —— */
function updateBookmarkPosition() {
const percent = Number(getSettingSafe("bookmarkTopPercent", 60));
document.documentElement.style.setProperty("--bookmark-top", `${percent}vh`);
}

/* —— Collapsed State (Local Machine Global) —— */
function getGlobalCollapsed() {
try { return JSON.parse(localStorage.getItem(`${MODULE_ID}_collapsed`) || "false"); } catch(e){ return false; }
}
function setGlobalCollapsed(v) {
try { localStorage.setItem(`${MODULE_ID}_collapsed`, JSON.stringify(!!v)); } catch(e){}
}
function applyGlobalCollapse() {
const collapsed = getGlobalCollapsed();
const hud = document.getElementById("status-hud-container");
const hand = document.getElementById("poker-hand-container");
const sleepHudOnly = !!getSettingSafe("sleepHudOnly", false);
if (hud) hud.classList.toggle("collapsed", collapsed);
if (hand) {
if (sleepHudOnly) hand.classList.remove("collapsed");
else hand.classList.toggle("collapsed", collapsed);
}
if (collapsed) deckSleep(); else setTimeout(deckWake, 150);
}
function ensureDeckFaceDownIfCollapsed() {
if (getGlobalCollapsed()) deckSleep();
}

/* —— Sparkles (Player Local Setting) —— */
function getSparkleRates() {
const level = getSettingSafe("sparkleIntensity", "high");
if (level === "low") return { base: 1100, hover: 520 };
if (level === "high") return { base: 380, hover: 180 };
return { base: 700, hover: 300 };
}
function setupSparkles(container) {
container.querySelector(".sparkle-layer")?.remove();
if (pokerHandGlobalState.sparkleInterval) { clearInterval(pokerHandGlobalState.sparkleInterval); pokerHandGlobalState.sparkleInterval = null; }
if (pokerHandGlobalState._sparkleHandlers) {
const { enter, leave, container: c } = pokerHandGlobalState._sparkleHandlers;
if (c) { c.removeEventListener("mouseenter", enter); c.removeEventListener("mouseleave", leave); }
pokerHandGlobalState._sparkleHandlers = null;
}

const style = getSettingSafe("sparkleStyle", "embers");
if (style === "none") return;

const layer = document.createElement("div");
layer.className = "sparkle-layer";
container.appendChild(layer);
const { base, hover } = getSparkleRates();

const spawn = () => {
if (getGlobalCollapsed()) return;
const W = layer.clientWidth || 1100;
const x = Math.random() * (W - 80) + 40;
const bottom = 2 + Math.random() * 12;

const s = document.createElement("div");
s.className = "sparkle";
const size = 2.5 + Math.random() * 4.5;
const dur = 1.1 + Math.random() * 1.3;
const dx = (Math.random() - 0.5) * 36;
const rot = (Math.random() * 360 - 180).toFixed(1);

s.style.left = `${Math.round(x)}px`;
s.style.bottom = `${Math.round(bottom)}px`;
s.style.setProperty("--dx", `${dx}px`);
s.style.setProperty("--dur", `${dur}s`);
s.style.setProperty("--sc", `${0.9 + Math.random() * 0.6}`);
s.style.setProperty("--rot", `${rot}deg`);

const makeTextSpark = (cls, char, color, fsMin=12, fsMax=20, shadow="0 0 8px rgba(255,255,255,0.35)") => {
s.classList.add("text", cls);
s.textContent = char;
s.style.fontSize = `${Math.round(fsMin + Math.random() * (fsMax-fsMin))}px`;
s.style.color = color;
s.style.textShadow = shadow;
s.style.mixBlendMode = "screen";
s.style.userSelect = "none";
};

if (style === "gold" || style === "embers" || style === "blue") {
s.style.width = `${size}px`;
s.style.height = `${size}px`;
s.style.borderRadius = "50%";
if (style === "gold") {
s.style.background = "radial-gradient(circle, rgba(255,235,190,0.98) 0%, rgba(255,220,150,0.7) 45%, rgba(255,220,150,0.18) 70%, rgba(255,220,150,0) 100%)";
s.style.boxShadow = "0 0 10px rgba(192,160,96,0.95), 0 0 20px rgba(192,160,96,0.5)";
} else if (style === "embers") {
s.style.background = "radial-gradient(circle, rgba(255,200,130,0.98) 0%, rgba(255,150,80,0.65) 45%, rgba(255,110,60,0.18) 70%, rgba(255,110,60,0) 100%)";
s.style.boxShadow = "0 0 10px rgba(255,140,70,0.95), 0 0 20px rgba(255,140,70,0.5)";
} else if (style === "blue") {
s.style.background = "radial-gradient(circle, rgba(185,230,255,0.98) 0%, rgba(150,210,255,0.7) 45%, rgba(150,210,255,0.18) 70%, rgba(150,210,255,0) 100%)";
s.style.boxShadow = "0 0 10px rgba(140,190,255,0.95), 0 0 20px rgba(140,190,255,0.5)";
}
} else if (style === "runes") {
const runes = "ᚠᚢᚦᚨᚱᚲᚺᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛝᛟ";
makeTextSpark("runes", runes[Math.floor(Math.random()*runes.length)], "rgba(255,230,170,0.95)", 12, 20, "0 0 10px rgba(255,220,150,0.8),0 0 20px rgba(192,160,96,0.6)");
} else if (style === "petals") {
const petals = ["❀","✿","❁","❃","❋"];
makeTextSpark("petals", petals[Math.floor(Math.random()*petals.length)], "rgba(255,180,200,0.95)", 14, 22, "0 0 8px rgba(255,160,190,0.65)");
} else if (style === "butterflies") {
makeTextSpark("butterflies", "🦋", "rgba(180,220,255,0.95)", 16, 22, "0 0 10px rgba(150,210,255,0.6)");
s.style.mixBlendMode = "lighter";
} else if (style === "notes") {
const notes = ["♪","♫","♩","♬"];
makeTextSpark("notes", notes[Math.floor(Math.random()*notes.length)], "rgba(150,210,255,0.95)", 14, 22, "0 0 10px rgba(140,190,255,0.6)");
} else if (style === "cards") {
const suits = ["♠","♥","♦","♣"];
const ch = suits[Math.floor(Math.random()*suits.length)];
const color = (ch === "♥" || ch === "♦") ? "rgba(255,120,140,0.95)" : "rgba(220,235,255,0.95)";
makeTextSpark("cards", ch, color, 14, 22, "0 0 10px rgba(255,255,255,0.35)");
s.style.fontWeight = "900";
} else if (style === "matrix") {
const matrixChars = "アァカサタナハマヤャラワガザダバパイキシチニヒミリヰギジビピウゥク";
makeTextSpark("matrix", matrixChars[Math.floor(Math.random()*matrixChars.length)], "rgba(80,255,120,0.95)", 12, 18, "0 0 8px rgba(80,255,120,0.7)");
s.style.mixBlendMode = "lighter";
} else if (style === "sakura") {
makeTextSpark("sakura", "🌸", "rgba(255,210,220,0.95)", 14, 22, "0 0 10px rgba(255,190,210,0.6)");
} else if (style === "bubbles") {
s.style.width = `${size * 2}px`; s.style.height = `${size * 2}px`; s.style.borderRadius = "50%";
s.style.background = "radial-gradient(circle, rgba(200,230,255,0.5) 0%, rgba(180,220,255,0.1) 70%, rgba(180,220,255,0) 100%)";
s.style.border = "1px solid rgba(220,240,255,0.6)";
s.style.boxShadow = "inset 0 0 8px rgba(200,230,255,0.3)";
} else if (style === "gears") {
const gears = ["⚙️","⚛"];
makeTextSpark("gears", gears[Math.floor(Math.random()*gears.length)], "rgba(200,200,200,0.9)", 14, 20, "0 0 6px rgba(180,180,180,0.5)");
} else if (style === "sparks") {
s.style.width = `${size * 0.5}px`; s.style.height = `${size * 2.5}px`; s.style.borderRadius = "2px";
s.style.background = "linear-gradient(180deg, rgba(255,240,200,1) 0%, rgba(255,180,100,1) 100%)";
s.style.boxShadow = "0 0 10px rgba(255,200,100,0.9)";
}

layer.appendChild(s);
s.addEventListener("animationend", () => s.remove());
};

pokerHandGlobalState.sparkleInterval = setInterval(spawn, base);
const enter = () => { if (pokerHandGlobalState.sparkleInterval) clearInterval(pokerHandGlobalState.sparkleInterval);
pokerHandGlobalState.sparkleInterval = setInterval(() => { spawn(); if (Math.random() < 0.5) spawn(); }, hover);
};
const leave = () => { if (pokerHandGlobalState.sparkleInterval) clearInterval(pokerHandGlobalState.sparkleInterval);
pokerHandGlobalState.sparkleInterval = setInterval(spawn, base);
};
container.addEventListener("mouseenter", enter);
container.addEventListener("mouseleave", leave);
pokerHandGlobalState._sparkleHandlers = { enter, leave, container };
}
function restartSparkles() {
const container = document.getElementById("poker-hand-container");
if (container) setupSparkles(container);
}

/* —— Theme Parsing (Card Back + HUD BG; HUD supports local override) —— */
function resolveCardBackUrl() {
    const clientUrl = (getSettingSafe("clientBackCustomUrl", "") || "").trim();
    if (clientUrl) return clientUrl;
    const worldUrl = (getSettingSafe("cardBackImageUrl", "") || "").trim();
    return worldUrl; 
}
function resolveHudBgUrl() {
    const clientUrl = (getSettingSafe("clientHudCustomUrl", "") || "").trim();
    if (clientUrl) return clientUrl;
    const worldUrl = (getSettingSafe("hudBgImageUrl", "") || "").trim();
    return worldUrl;
}


/* —— Settings Registration —— */
Hooks.once("init", () => {
    const rngObj = (min, max, step) => ({ min, max, step, type: Number });

    const settings = [
        // --- Basic Settings ---
        { key: "enabled", data: { name: "Enable Automatically", scope: "world", config: true, type: Boolean, default: true } },
        { key: "onlyPlayers", data: { name: "Only for Players", scope: "world", config: true, type: Boolean, default: false } },
        { key: "clientOptOut", data: { name: "Disable Locally", scope: "client", config: true, type: Boolean, default: false } },
        { key: "clientBackCustomUrl", data: { name: "Custom Card Back URL (Local)", hint: "Leave empty to use world setting. If world setting is also empty, the default CSS card back will be shown.", scope: "client", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(false) } },
        { key: "clientHudCustomUrl", data: { name: "Custom HUD Background URL (Local)", hint: "Leave empty to use world setting. If world setting is also empty, a default translucent background will be shown.", scope: "client", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(false) } },
        { key: "clientCustomTokenBorderUrl", data: { name: "Custom Token Border URL (Local)", hint: "Upload an image to use as a border for the character token in the HUD. Leave empty for no border.", scope: "client", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(true) } },
        { key: "handMaxVisible", data: { name: "Max Visible Cards in Hand", scope: "world", config: true, type: Number, default: 7, range: rngObj(3, 10, 1), onChange: () => scheduleRebuild(true) } },
        { key: "bookmarkTopPercent", data: { name: "Bookmark Vertical Position (% Screen Height)", scope: "world", config: true, type: Number, default: 60, range: rngObj(5, 95, 1), onChange: () => updateBookmarkPosition() } },
        { key: "sparkleStyle", data: { name: "Sparkle Style (Local)", scope: "client", config: true, type: String, default: "embers", choices: { "none": "None", "gold": "Gold Particles", "embers": "Embers", "blue": "Blue Magic", "runes": "Runes", "petals": "Petals", "butterflies": "Butterflies", "notes": "Musical Notes", "cards": "Playing Cards", "matrix": "Matrix Code", "sakura": "Sakura", "bubbles": "Bubbles", "gears": "Gears", "sparks": "Sparks" }, onChange: () => scheduleRebuild(false) } },
        { key: "sparkleIntensity", data: { name: "Sparkle Intensity (Local)", scope: "client", config: true, type: String, default: "high", choices: { "low": "Low", "medium": "Medium", "high": "High" }, onChange: () => scheduleRebuild(false) } },
        { key: "sfxEnabled", data: { name: "Enable SFX (Local)", scope: "client", config: true, type: Boolean, default: true, onChange: () => { SFX.load(); } } },
        { key: "sfxVolume", data: { name: "SFX Volume (0-1)", scope: "client", config: true, type: Number, default: 0.85, range: rngObj(0, 1, 0.05), onChange: () => { SFX.load(); } } },
        { key: "sfxHoverUrl", data: { name: "Hover SFX URL", scope: "client", config: true, type: String, default: "path/to/file.ext", filePicker: "audio", onChange: () => { SFX.load(); } } },
        { key: "sfxClickUrl", data: { name: "Click/Select SFX URL", scope: "client", config: true, type: String, default: "path/to/file.ext", filePicker: "audio", onChange: () => { SFX.load(); } } },
        { key: "sfxUseUrl", data: { name: "Use Item SFX URL", scope: "client", config: true, type: String, default: "path/to/file.ext", filePicker: "audio", onChange: () => { SFX.load(); } } },
        { key: "legendaryGlowEnabled", data: { name: "Enable Legendary Glow (Local)", hint: "Only affects card backs when the hand is small; not visible when cards are face up.", scope: "client", config: true, type: Boolean, default: true, onChange: () => scheduleRebuild(false) } },
        { key: "legendaryGlowStyle", data: { name: "Legendary Glow Style (Local)", scope: "client", config: true, type: String, default: "classic", choices: { "none": "None", "classic": "Classic Gold Spin", "halo": "Soft Halo", "rays": "Radiant Rays", "prism": "Prismatic Flow", "runes": "Runic Circle", "embers": "Flowing Embers", "holy": "Holy Radiance", "unholy": "Fel Energy", "ice": "Frost", "vortex": "Vortex", "electric": "Electric" }, onChange: () => scheduleRebuild(false) } },

        // --- Advanced Settings (will appear after the basic ones) ---
        { key: "cardBaseImageUrl", data: { name: "Card UI Background URL (World)", hint: "Leave empty to use the default CSS style.", scope: "world", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(true) } },
        { key: "cardMaskImageUrl", data: { name: "Card Art Mask URL (World)", hint: "Provides a shape mask for card art. Leave empty for the default gradient effect.", scope: "world", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(true) } },
        { key: "cardBackImageUrl", data: { name: "Custom Card Back URL (World)", hint: "Leave empty to use the default CSS card back.", scope: "world", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(false) } },
        { key: "hudBgImageUrl", data: { name: "Custom HUD Background URL (World)", hint: "Leave empty for the default translucent background.", scope: "world", config: true, type: String, default: "", filePicker: "image", onChange: () => scheduleRebuild(false) } },
        { key: "hudBgColor", data: { name: "HUD Background Color (Frosted Glass)", scope: "world", config: true, type: String, default: "#1c1c24", onChange: () => scheduleRebuild(false) } },
        { key: "accentColor", data: { name: "Accent Color / Border", scope: "world", config: true, type: String, default: "#c0a060", onChange: () => scheduleRebuild(false) } },
        { key: "labelColor", data: { name: "Label Text Color", scope: "world", config: true, type: String, default: "#ffffff", onChange: () => scheduleRebuild(false) } },
        { key: "textColor", data: { name: "HUD Text Color", scope: "world", config: true, type: String, default: "#ffffff", onChange: () => scheduleRebuild(false) } },
        { key: "selectedGlowColor", data: { name: "Selected Card Glow Color (Setup)", scope: "world", config: true, type: String, default: "#ff9900", onChange: () => scheduleRebuild(false) } },
        { key: "dotHP", data: { name: "HP Theme Color", scope: "world", config: true, type: String, default: "#c05050", onChange: () => scheduleRebuild(false) } },
        { key: "dotStress", data: { name: "Stress Theme Color", scope: "world", config: true, type: String, default: "#6a3d9a", onChange: () => scheduleRebuild(false) } },
        { key: "dotHope", data: { name: "Hope Theme Color", scope: "world", config: true, type: String, default: "#2aa4ff", onChange: () => scheduleRebuild(false) } },
        { key: "dotArmor", data: { name: "Armor Theme Color", scope: "world", config: true, type: String, default: "#a0a0a0", onChange: () => scheduleRebuild(false) } },
        { key: "hudLabelFontSize", data: { name: "Label Font Size (px)", scope: "world", config: true, type: Number, default: 11, range: rngObj(8, 24, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudValueFontSize", data: { name: "Value Font Size (px)", scope: "world", config: true, type: Number, default: 12, range: rngObj(10, 28, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudButtonFontSize", data: { name: "Top Buttons Font Size (px)", scope: "world", config: true, type: Number, default: 10, range: rngObj(8, 18, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudMaxWidth", data: { name: "HUD Max Width (px)", scope: "world", config: true, type: Number, default: 1010, range: rngObj(600, 1400, 10), onChange: () => scheduleRebuild(false) } },
        { key: "hudHeightPx", data: { name: "HUD Height (px)", scope: "world", config: true, type: Number, default: 150, range: rngObj(90, 160, 2), onChange: () => scheduleRebuild(false) } },
        { key: "sidePanelWidthPx", data: { name: "Column Min Width (px)", scope: "world", config: true, type: Number, default: 70, range: rngObj(60, 160, 2), onChange: () => scheduleRebuild(false) } },
        { key: "tokenSizePx", data: { name: "Token Size (px)", scope: "world", config: true, type: Number, default: 56, range: rngObj(40, 96, 2), onChange: () => scheduleRebuild(false) } },
        { key: "hudRowGapPx", data: { name: "HUD Row Gap (px)", scope: "world", config: true, type: Number, default: 5, range: rngObj(2, 14, 1), onChange: () => scheduleRebuild(false) } },
        { key: "charNameFontSizePx", data: { name: "Character Name Font Size (px)", scope: "world", config: true, type: Number, default: 12, range: rngObj(12, 32, 1), onChange: () => scheduleRebuild(false) } },
        { key: "charClassFontSizePx", data: { name: "Class Name Font Size (px)", scope: "world", config: true, type: Number, default: 10, range: rngObj(10, 24, 1), onChange: () => scheduleRebuild(false) } },
        { key: "cardNameArc", data: { name: "Card Name Arc (Smaller=Curvier)", scope: "world", config: true, type: Number, default: 7, range: rngObj(-10, 30, 1), onChange: () => scheduleRebuild(false) } },
        { key: "cardNameFontSizePx", data: { name: "Card Name Font Size (px)", scope: "world", config: true, type: Number, default: 19, range: rngObj(10, 24, 1), onChange: () => scheduleRebuild(false) } },
        { key: "cardNameWeight", data: { name: "Card Name Weight (100-900)", scope: "world", config: true, type: Number, default: 850, range: rngObj(300, 900, 50), onChange: () => scheduleRebuild(false) } },
        { key: "cardNameStrokePx", data: { name: "Card Name Stroke (px)", scope: "world", config: true, type: Number, default: 0.7, range: rngObj(0, 2, 0.1), onChange: () => scheduleRebuild(false) } },
        { key: "cardNameLetterPx", data: { name: "Card Name Letter Spacing (px)", scope: "world", config: true, type: Number, default: 0.2, range: rngObj(0, 2, 0.1), onChange: () => scheduleRebuild(false) } },
        { key: "hudBgScaleX", data: { name: "HUD BG Width Multiplier", scope: "world", config: true, type: Number, default: 0.95, range: rngObj(0.5, 6.0, 0.05), onChange: () => scheduleRebuild(false) } },
        { key: "hudBgScaleY", data: { name: "HUD BG Height Multiplier", scope: "world", config: true, type: Number, default: 1.65, range: rngObj(0.5, 6.0, 0.05), onChange: () => scheduleRebuild(false) } },
        { key: "hudBgOffsetY", data: { name: "HUD BG Vertical Offset (px)", scope: "world", config: true, type: Number, default: 154, range: rngObj(-300, 300, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudBgParallaxPx", data: { name: "BG Parallax Intensity (px)", scope: "world", config: true, type: Number, default: 3, range: rngObj(0, 30, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudContentOffsetY", data: { name: "HUD Content Vertical Offset (px)", scope: "world", config: true, type: Number, default: 14, range: rngObj(-200, 200, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudTabsFadeOpacity", data: { name: "Top Buttons Fade Opacity (0-1)", scope: "world", config: true, type: Number, default: 0.25, range: rngObj(0, 1, 0.05), onChange: () => scheduleRebuild(false) } },
        { key: "hudTabsFadeDelayMs", data: { name: "Top Buttons Fade Delay (ms)", scope: "world", config: true, type: Number, default: 800, range: rngObj(0, 5000, 50), onChange: () => scheduleRebuild(false) } },
        { key: "hudTabsOffsetX", data: { name: "Top Buttons Horizontal Offset (px)", scope: "world", config: true, type: Number, default: -355, range: rngObj(-400, 400, 1), onChange: () => scheduleRebuild(false) } },
        { key: "hudTabsOffsetY", data: { name: "Top Buttons Vertical Offset (px)", scope: "world", config: true, type: Number, default: 39, range: rngObj(-200, 200, 1), onChange: () => scheduleRebuild(false) } },
        { key: "sleepHudOnly", data: { name: "On Sleep, Collapse HUD Only", scope: "world", config: true, type: Boolean, default: false, onChange: () => applyGlobalCollapse() } },
        { key: "foldHudOnSleep", data: { name: "Fold HUD on Sleep (vs. Fade Out)", scope: "world", config: true, type: Boolean, default: true, onChange: () => scheduleRebuild(false) } },
        { key: "hudSleepOpacity", data: { name: "HUD Sleep Opacity (0-1)", scope: "world", config: true, type: Number, default: 0, range: rngObj(0, 1, 0.05), onChange: () => scheduleRebuild(false) } },
        { key: "tooltipWidth", data: { name: "Tooltip Width (px)", scope: "world", config: true, type: Number, default: 310, range: rngObj(260, 560, 10), onChange: () => scheduleRebuild(false) } },
        { key: "tooltipMaxHeightVh", data: { name: "Tooltip Max Height (vh)", scope: "world", config: true, type: Number, default: 60, range: rngObj(30, 90, 2), onChange: () => scheduleRebuild(false) } },
        { key: "tooltipOffsetY", data: { name: "Tooltip Distance from Card (px)", scope: "world", config: true, type: Number, default: 60, range: rngObj(20, 120, 2), onChange: () => scheduleRebuild(false) } },
        { key: "cardWidth", data: { name: "Card Width (px)", scope: "world", config: true, type: Number, default: 180, range: rngObj(160, 320, 5), onChange: () => scheduleRebuild(true) } },
        { key: "cardHeight", data: { name: "Card Height (px)", scope: "world", config: true, type: Number, default: 280, range: rngObj(220, 480, 5), onChange: () => scheduleRebuild(true) } },
        { key: "hoverScale", data: { name: "Hover Scale", scope: "world", config: true, type: Number, default: 1.35, range: rngObj(1.05, 1.4, 0.01), onChange: () => scheduleRebuild(false) } },
        { key: "hoverLift", data: { name: "Hover Lift (px, negative is up)", scope: "world", config: true, type: Number, default: -120, range: rngObj(-200, 0, 2), onChange: () => scheduleRebuild(false) } },
        { key: "tiltMax", data: { name: "Hover Max Tilt (degrees)", scope: "world", config: true, type: Number, default: 6, range: rngObj(0, 15, 1), onChange: () => scheduleRebuild(false) } },
        { key: "handSpacing", data: { name: "Hand Spacing (px)", scope: "world", config: true, type: Number, default: 105, range: rngObj(80, 200, 5), onChange: () => scheduleRebuild(true) } },
        { key: "handArc", data: { name: "Hand Arc Factor", scope: "world", config: true, type: Number, default: 5, range: rngObj(2, 16, 0.5), onChange: () => scheduleRebuild(true) } },
        { key: "handRotation", data: { name: "Hand Rotation Factor", scope: "world", config: true, type: Number, default: 5, range: rngObj(2, 16, 0.5), onChange: () => scheduleRebuild(true) } },
        { key: "handActiveHeight", data: { name: "Hand Active Height (px)", scope: "world", config: true, type: Number, default: 110, range: rngObj(100, 220, 5), onChange: () => scheduleRebuild(false) } },
        { key: "handInactiveHeight", data: { name: "Hand Inactive Height (px)", scope: "world", config: true, type: Number, default: 60, range: rngObj(-60, 60, 1), onChange: () => scheduleRebuild(false) } },
        { key: "handRetractDelay", data: { name: "Retract Delay (ms)", scope: "world", config: true, type: Number, default: 1000, range: rngObj(300, 3000, 100), onChange: () => scheduleRebuild(false) } },
    ];

    settings.forEach(s => {
        game.settings.register(MODULE_ID, s.key, s.data);
    });
});


/* —— Apply Settings to Config Object —— */
function applySettingsToConfig(config) {
const px = (n, unit="px") => `${n}${unit}`;
config.cardVisuals.baseImage = getSettingSafe("cardBaseImageUrl", "");
config.cardVisuals.artMaskImage = getSettingSafe("cardMaskImageUrl", "");
config.cardVisuals.backImage = resolveCardBackUrl();

config.cardVisuals.nameStyle ??= {};
config.cardVisuals.nameStyle.arc = Number(getSettingSafe("cardNameArc", 7));
config.cardVisuals.nameStyle.fontSize = px(getSettingSafe("cardNameFontSizePx", 19));
config.cardVisuals.nameStyle.weight = Number(getSettingSafe("cardNameWeight", 850));
config.cardVisuals.nameStyle.stroke = px(getSettingSafe("cardNameStrokePx", 0.7));
config.cardVisuals.nameStyle.letter = px(getSettingSafe("cardNameLetterPx", 0.2));

config.statusHUD.backgroundImage = resolveHudBgUrl();
config.statusHUD.backgroundColor = hexToRgba(getSettingSafe("hudBgColor", "#1c1c24"), 0.85);
config.statusHUD.borderColor = getSettingSafe("accentColor", "#c0a060");
config.statusHUD.labelColor = getSettingSafe("labelColor", "#ffffff");
config.statusHUD.textColor = getSettingSafe("textColor", "#ffffff");

config.statusHUD.bgScaleX = Number(getSettingSafe("hudBgScaleX", 0.95));
config.statusHUD.bgScaleY = Number(getSettingSafe("hudBgScaleY", 1.65));
config.statusHUD.bgOffsetY = Number(getSettingSafe("hudBgOffsetY", 154));
config.statusHUD.bgParallaxPx = Number(getSettingSafe("hudBgParallaxPx", 3));

config.statusHUD.tabsFadeOpacity = Number(getSettingSafe("hudTabsFadeOpacity", 0.25));
config.statusHUD.tabsFadeDelay = Number(getSettingSafe("hudTabsFadeDelayMs", 800));
config.statusHUD.tabsOffsetX = Number(getSettingSafe("hudTabsOffsetX", -355));
config.statusHUD.tabsOffsetY = Number(getSettingSafe("hudTabsOffsetY", 39));
config.statusHUD.contentOffsetY = Number(getSettingSafe("hudContentOffsetY", 14));
config.statusHUD.foldOnSleep = !!getSettingSafe("foldHudOnSleep", true);
config.statusHUD.sleepHudOnly = !!getSettingSafe("sleepHudOnly", false);
config.statusHUD.sleepOpacity = Number(getSettingSafe("hudSleepOpacity", 0));

config.selectedBorderColor = getSettingSafe("selectedGlowColor", "#ff9900");

config.statusHUD.dotFilledHP = getSettingSafe("dotHP", "#c05050");
config.statusHUD.dotFilledStress = getSettingSafe("dotStress", "#6a3d9a");
config.statusHUD.dotFilledHope = getSettingSafe("dotHope", "#2aa4ff");
config.statusHUD.dotFilledArmor = getSettingSafe("dotArmor", "#a0a0a0");

config.hudLayout ??= {};
config.hudLayout.labelFontSize = px(getSettingSafe("hudLabelFontSize", 11));
config.hudLayout.valueFontSize = px(getSettingSafe("hudValueFontSize", 12));
config.hudLayout.buttonFontSize = px(getSettingSafe("hudButtonFontSize", 10));
config.hudLayout.hudMaxWidth = px(getSettingSafe("hudMaxWidth", 1010));
config.hudLayout.hudHeight = px(getSettingSafe("hudHeightPx", 150));
config.hudLayout.sidePanelWidth = px(getSettingSafe("sidePanelWidthPx", 70));
config.hudLayout.rowGap = px(getSettingSafe("hudRowGapPx", 5));

config.statusHUD.infoStyle ??= {};
config.statusHUD.infoStyle.nameSize = px(getSettingSafe("charNameFontSizePx", 12));
config.statusHUD.infoStyle.classSize = px(getSettingSafe("charClassFontSizePx", 10));

config.statusHUD.tokenStyle ??= {};
config.statusHUD.tokenStyle.size = px(getSettingSafe("tokenSizePx", 56));
config.statusHUD.tokenStyle.borderImage = getSettingSafe("clientCustomTokenBorderUrl", "");

config.tooltip = config.tooltip || {};
config.tooltip.width = px(getSettingSafe("tooltipWidth", 310));
config.tooltip.maxHeight = `${getSettingSafe("tooltipMaxHeightVh", 60)}vh`;
config.tooltip.offsetY = Number(getSettingSafe("tooltipOffsetY", 60));

config.cardVisuals.width = Number(getSettingSafe("cardWidth", 180));
config.cardVisuals.height = Number(getSettingSafe("cardHeight", 280));

config.interactiveHover = config.interactiveHover || {};
config.interactiveHover.scale = Number(getSettingSafe("hoverScale", 1.35));
config.interactiveHover.lift = Number(getSettingSafe("hoverLift", -120));
config.interactiveHover.tiltMax = Number(getSettingSafe("tiltMax", 6));

config.handLayout ??= {};
config.handLayout.maxVisibleCards = Number(getSettingSafe("handMaxVisible", 7));
config.handLayout.spacing = Number(getSettingSafe("handSpacing", 105));
config.handLayout.arcHeight = Number(getSettingSafe("handArc", 5));
config.handLayout.rotationFactor = Number(getSettingSafe("handRotation", 5));

config.handHeights ??= {};
config.handHeights.active = px(getSettingSafe("handActiveHeight", 110));
config.handHeights.inactive = px(getSettingSafe("handInactiveHeight", 60));
config.handHeights.retractDelay = Number(getSettingSafe("handRetractDelay", 1000));

config.legendaryGlowEnabled = !!getSettingSafe("legendaryGlowEnabled", true);
config.legendaryGlowStyle = getSettingSafe("legendaryGlowStyle", "classic");
}

/* —— Startup —— */
Hooks.once("ready", async () => {
try {
SFX.load();
installBookmarkToggle();
if (!getSettingSafe("enabled", true)) return;
if (getSettingSafe("clientOptOut", false)) return;
if (!canvas?.ready) await new Promise(res => Hooks.once("canvasReady", res));
displayItemsAsPokerHand();
} catch (e) { console.error(`[${MODULE_ID}] Initialization failed:`, e); }
});

function rebuildStylesOnly() {
const g = window.pokerHandGlobalState;
if (!g?.config) return;
applySettingsToConfig(g.config);

const bgImg = document.getElementById("hud-bg-img");
if (bgImg) {
bgImg.src = g.config.statusHUD.backgroundImage || "";
bgImg.style.setProperty("--hud-bg-scale-x", g.config.statusHUD.bgScaleX);
bgImg.style.setProperty("--hud-bg-scale-y", g.config.statusHUD.bgScaleY);
bgImg.style.setProperty("--hud-bg-offset-y", `${g.config.statusHUD.bgOffsetY}px`);
}
const wrp = document.getElementById("status-hud-inner-wrapper");
const hud = document.getElementById("status-hud-container");
if (wrp) {
wrp.style.setProperty("--phh-label-font", g.config.hudLayout.labelFontSize);
wrp.style.setProperty("--phh-value-font", g.config.hudLayout.valueFontSize);
wrp.style.setProperty("--phh-row-gap", g.config.hudLayout.rowGap);
wrp.style.setProperty("--phh-tab-font", g.config.hudLayout.buttonFontSize);
wrp.style.setProperty("--phh-name-font", g.config.statusHUD.infoStyle.nameSize);
wrp.style.setProperty("--phh-class-font", g.config.statusHUD.infoStyle.classSize);
wrp.style.setProperty("--hud-tabs-fade-opacity", g.config.statusHUD.tabsFadeOpacity);
wrp.style.setProperty("--hud-content-offset-y", `${g.config.statusHUD.contentOffsetY}px`);
wrp.style.setProperty("--hud-tabs-offset-x", `${g.config.statusHUD.tabsOffsetX}px`);
wrp.style.setProperty("--hud-tabs-offset-y", `${g.config.statusHUD.tabsOffsetY}px`);
wrp.style.setProperty("--hud-sleep-opacity", g.config.statusHUD.sleepOpacity);
}
if (hud) hud.classList.toggle("collapsed", getGlobalCollapsed());

const ph = document.getElementById("poker-hand-container");
if (ph) {
ph.dataset.legendary = g.config.legendaryGlowStyle || "classic";
ph.dataset.legendaryEnabled = g.config.legendaryGlowEnabled ? "1" : "0";
}

const tokenWrapper = document.querySelector(".status-hud-token-wrapper");
if (tokenWrapper) {
tokenWrapper.style.width = g.config.statusHUD.tokenStyle.size;
tokenWrapper.style.height = g.config.statusHUD.tokenStyle.size;
const borderUrl = getSettingSafe("clientCustomTokenBorderUrl", "");
tokenWrapper.style.backgroundImage = borderUrl ? `url('${borderUrl}')` : "none";
}

recenterHUDColumns();
g.rebuildStyles?.();
}

/* —— Actor Selection (Original Logic) —— */
function selectActorOriginal() {
const controlled = canvas.tokens.controlled?.filter(t => !!t.actor) ?? [];
if (controlled.length) return controlled[controlled.length-1].actor;
if (game.user?.character) return game.user.character;
const owned = game.actors?.filter(a => a.isOwner && a.type === "character") || [];
return owned[0] || null;
}

/* —— Left Bookmark Toggle (Always present) —— */
function installBookmarkToggle() {
if (document.getElementById("hud-bookmark-toggle")) return;
const toggle = document.createElement("div");
toggle.id = "hud-bookmark-toggle";
toggle.innerHTML = `<div class="tab-label">HUD</div><div class="chev"><i class="fas fa-chevron-left"></i></div>`;
document.body.appendChild(toggle);
const refresh = () => {
const collapsed = getGlobalCollapsed();
toggle.classList.toggle("collapsed", collapsed);
const chev = toggle.querySelector(".chev i");
if (chev) chev.className = `fas fa-chevron-${collapsed ? "right" : "left"}`;
toggle.title = collapsed ? "Expand HUD" : "Collapse HUD";
toggle.style.opacity = collapsed ? "0.85" : "1";
};
const doToggle = () => { setGlobalCollapsed(!getGlobalCollapsed()); applyGlobalCollapse(); refresh(); ui.controls?.render(true); };
toggle.addEventListener("click", () => { SFX.play(SFX.click); doToggle(); });
toggle.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); SFX.play(SFX.click); doToggle(); }});
refresh(); updateBookmarkPosition();
}

/* —— Unified Sleep/Wake Functions —— */
function deckSleep() { document.querySelectorAll("#poker-hand-container .poker-card").forEach(c => c.classList.add("face-down")); }
function deckWake() { if (getGlobalCollapsed()) return; document.querySelectorAll("#poker-hand-container .poker-card").forEach(c => c.classList.remove("face-down")); }

/* —— Recenter HUD Columns —— */
function recenterHUDColumns() {
try {
const hud = document.getElementById("status-hud-container");
if (!hud) return;
const left = hud.querySelector(".status-hud-column.left");
const right = hud.querySelector(".status-hud-column.right");
const center = hud.querySelector(".status-hud-center");
if (!left || !right || !center) return;
const lw = left.getBoundingClientRect().width;
const rw = right.getBoundingClientRect().width;
const delta = lw - rw;
center.style.setProperty("--phh-center-shift", `${-delta/2}px`);
} catch (e) { console.warn(`[${MODULE_ID}] recenterHUDColumns failed`, e); }
}

/* —— Main Function —— */
async function displayItemsAsPokerHand() {
    pokerHandGlobalState.cleanup?.();

    const actor = selectActorOriginal();
    if (!actor) {
        ui.notifications.warn("Please select a token or ensure you own a character.");
        return;
    }
    pokerHandGlobalState.actor = actor;

    const config = {
        tooltip: { enabled: true, width: "340px", backgroundColor: "rgba(10,5,0,0.92)", borderColor: "#c0a060", textColor: "#f0e6d2", padding: "12px", offsetY: 60, maxHeight: "60vh" },
        interactiveHover: { scale: 1.15, lift: -120, tiltMax: 6 },
        allowedType: "domainCard",
        selectedBorderColor: "#ff9900",
        handHeights: { active: "135px", inactive: "0px", retractDelay: 1000 },
        cardVisuals: { width: 220, height: 330, baseImage: "", artMaskImage: "", backImage: "", artBackgroundColor: "rgba(0,0,0,0.5)", artYOffset: 0, nameStyle: { arc: 10, fontSize: '12px', weight: 700, stroke: '0.3px', letter: '0.6px' } },
        handLayout: { maxVisibleCards: 6, spacing: 120, arcHeight: 8.5, rotationFactor: 8 },
        animations: { entranceDelay: 100 },
        hudLayout: { hudMaxWidth: '980px', hudHeight: '120px', labelFontSize: '12px', valueFontSize: '14px', buttonFontSize: '10px', sidePanelWidth: '90px', rowGap: '6px' },
        statusHUD: { enabled: true, backgroundImage: "", backgroundColor: "", borderColor: "", textColor: "", labelColor: "", dotEmptyColor: "#ffffff", dotEmptyBorder: "#888", dotFilledHP: "", dotFilledStress: "", dotFilledHope: "", dotFilledArmor: "", tokenStyle: { size: '62px', border: "2px solid white" }, infoStyle: { nameSize: '16px', nameColor: "white", classSize: '12px', classColor: "white" }, tabsFadeOpacity: 0.25, tabsFadeDelay: 800, tabsOffsetX: 0, tabsOffsetY: 0, contentOffsetY: 0, foldOnSleep: true, sleepHudOnly: true, sleepOpacity: 0, bgScaleX: 1.0, bgScaleY: 1.0, bgOffsetY: 0, bgParallaxPx: 6 }
    };

    applySettingsToConfig(config);
    pokerHandGlobalState.config = config;

    /* —— Create HUD Function —— */
    function createStatusHUD(actor) {
        document.getElementById("status-hud-container")?.remove();
        if (!config.statusHUD.enabled) return;

        const hud = document.createElement("div");
        hud.id = "status-hud-container";
        hud.dataset.foldHud = config.statusHUD.foldOnSleep ? "1" : "0";
        hud.classList.toggle("collapsed", getGlobalCollapsed());

        const innerWrapper = document.createElement("div");
        innerWrapper.id = "status-hud-inner-wrapper";

        let bgImg = null;
        if (config.statusHUD.backgroundImage) {
            bgImg = document.createElement("img");
            bgImg.id = "hud-bg-img";
            bgImg.src = config.statusHUD.backgroundImage;
            bgImg.alt = "hud background";
            bgImg.style.setProperty("--hud-bg-scale-x", `${config.statusHUD.bgScaleX ?? 1}`);
            bgImg.style.setProperty("--hud-bg-scale-y", `${config.statusHUD.bgScaleY ?? 1}`);
            bgImg.style.setProperty("--hud-bg-offset-y", `${config.statusHUD.bgOffsetY ?? 0}px`);
            innerWrapper.appendChild(bgImg);
            bgImg.onload = () => recenterHUDColumns();
        }

        const tabsBar = document.createElement("div");
        tabsBar.id = "hud-tabs-bar";
        const mk = (t, id) => { const el = document.createElement("div"); el.className = "hud-tab"; el.id = id; el.textContent = t; return el; };
        const tabConfirm = mk("Confirm", "tab-confirm"), tabReset = mk("Reset", "tab-reset"), tabConfig = mk("Setup", "tab-config"), tabItems = mk("Items", "tab-items"), tabFeat = mk("Features", "tab-features");
        [tabConfirm, tabReset, tabConfig, tabItems, tabFeat].forEach(t => tabsBar.appendChild(t));
        innerWrapper.appendChild(tabsBar);

        const mainPanel = document.createElement("div");
        mainPanel.className = "hud-main-panel";
        const leftColumn = document.createElement("div");
        leftColumn.className = "status-hud-column left";

        function createCrystal(type, filled = false) {
            const c = document.createElement("div");
            c.className = `crystal ${type}` + (filled ? " filled" : "");
            c.innerHTML = `
        <svg viewBox="0 0 100 110" preserveAspectRatio="xMidYMid meet">
        <polygon class="hex" points="50,5 90,30 90,80 50,105 10,80 10,30" />
        <linearGradient id="g-${type}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="white" stop-opacity="0.85"/>
        <stop offset="40%" stop-color="white" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </linearGradient>
        <polygon class="shine" points="50,5 90,30 90,45 50,20 10,45 10,30" fill="url(#g-${type})"/>
        </svg>`;
            return c;
        }

        function createTracker(label, cur, max, target, path, type) {
            max = Math.max(0, Number(max || 0));
            cur = Math.max(0, Math.min(Number(cur || 0), max));
            const wrap = document.createElement("div");
            wrap.className = "tracker-wrapper";
            const row = document.createElement("div");
            row.className = "resource-tracker";
            const labelEl = document.createElement("div");
            labelEl.className = "label";
            labelEl.textContent = `${label} (${cur}/${max})`;
            const panel = document.createElement("div");
            panel.className = "tracker-panel";
            for (let i = 1; i <= max; i++) {
                const crystal = createCrystal(type, i <= cur);
                crystal.addEventListener("click", async () => {
                    const currentValue = Number(getProperty(target, path) ?? cur) || 0;
                    const newValue = (i === currentValue) ? i - 1 : i;
                    await target.update({ [path]: newValue });
                });
                panel.appendChild(crystal);
            }
            row.appendChild(labelEl);
            wrap.appendChild(row);
            wrap.appendChild(panel);
            labelEl.addEventListener("click", () => {
                panel.classList.toggle("open");
                recenterHUDColumns();
                setTimeout(recenterHUDColumns, 180);
            });
            return wrap;
        }

        const res = actor.system?.resources || {};
        const hp = res.hitPoints || res.hp || {};
        const stress = res.stress || {};
        const hope = res.hope || {};

        const eqArmor = actor.items.find(i => (i.type || "").toLowerCase() === "armor" && i.system?.equipped);
        if (eqArmor) {
            const armorCur = eqArmor.system?.marks?.value ?? 0;
            const armorMax = eqArmor.system?.baseScore ?? eqArmor.system?.marks?.max ?? armorCur;
            leftColumn.appendChild(createTracker("Armor Slots", armorCur, armorMax, eqArmor, "system.marks.value", "armor"));
        }
        leftColumn.appendChild(createTracker("Hope", hope.value ?? 0, hope.max ?? 0, actor, "system.resources.hope.value", "hope"));
        leftColumn.appendChild(createTracker("Stress", stress.value ?? 0, stress.max ?? 0, actor, "system.resources.stress.value", "stress"));
        leftColumn.appendChild(createTracker("HP", hp.value ?? 0, hp.max ?? 0, actor, "system.resources.hitPoints.value", "hp"));

        const centerColumn = document.createElement("div");
        centerColumn.className = "status-hud-center";
        const tokenWrapper = document.createElement("div");
        tokenWrapper.className = "status-hud-token-wrapper";
        if (config.statusHUD.tokenStyle.borderImage) {
            tokenWrapper.style.backgroundImage = `url('${config.statusHUD.tokenStyle.borderImage}')`;
        }
        const tokenImg = document.createElement("img");
        tokenImg.className = "status-hud-token-img";
        tokenImg.src = actor.prototypeToken?.texture?.src || actor.img || "";
        tokenWrapper.addEventListener("dblclick", () => {
            SFX.play(SFX.click);
            actor?.sheet?.render(true);
        });
        tokenWrapper.appendChild(tokenImg);
        centerColumn.appendChild(tokenWrapper);

        const charName = document.createElement("div");
        charName.className = "char-name";
        charName.textContent = actor.name || "Unknown Character";
        centerColumn.appendChild(charName);
        const classItem = actor.items.find(i => (i.type || "").toLowerCase() === "class");
        const subClass = actor.items.find(i => (i.type || "").toLowerCase() === "subclass");
        const infoBar = document.createElement("div");
        infoBar.className = "character-info-bar";
        infoBar.style.textAlign = "center";
        infoBar.innerHTML = `<span class="char-class">${classItem?.name ?? "Unknown Class"} - ${subClass?.name ?? "Unknown Subclass"}</span>`;
        centerColumn.appendChild(infoBar);

        const rightColumn = document.createElement("div");
        rightColumn.className = "status-hud-column right";
        function mkStat(label, value) { const s = document.createElement("div"); s.className = "static-stat"; s.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`; return s; }
        const prof = mkStat("Proficiency", actor.system?.proficiency ?? "-");
        const evasion = mkStat("Evasion", actor.system?.evasion ?? "-");
        const thresholdsData = eqArmor ? (eqArmor.system?.baseThresholds || {}) : (actor.system?.damageThresholds || {});
        const lvl = actor.system?.levelData?.level?.current ?? actor.system?.level ?? 0;
        const finalMajor = (thresholdsData.major || 0) + (lvl || 0);
        const finalSevere = (thresholdsData.severe || 0) + (lvl || 0);
        const thresholds = mkStat("Thresholds", `${finalMajor}/${finalSevere}`);
        const levelStat = mkStat("Level", lvl);
        [prof, evasion, thresholds, levelStat].forEach(el => rightColumn.appendChild(el));

        [leftColumn, centerColumn, rightColumn].forEach(el => mainPanel.appendChild(el));
        innerWrapper.appendChild(mainPanel);
        hud.appendChild(innerWrapper);
        document.body.appendChild(hud);

        innerWrapper.style.setProperty("--phh-label-font", config.hudLayout.labelFontSize);
        innerWrapper.style.setProperty("--phh-value-font", config.hudLayout.valueFontSize);
        innerWrapper.style.setProperty("--phh-row-gap", config.hudLayout.rowGap);
        innerWrapper.style.setProperty("--phh-tab-font", config.hudLayout.buttonFontSize);
        innerWrapper.style.setProperty("--phh-name-font", config.statusHUD.infoStyle.nameSize);
        innerWrapper.style.setProperty("--phh-class-font", config.statusHUD.infoStyle.classSize);
        innerWrapper.style.setProperty("--hud-tabs-fade-opacity", `${config.statusHUD.tabsFadeOpacity}`);
        innerWrapper.style.setProperty("--hud-content-offset-y", `${config.statusHUD.contentOffsetY}px`);
        innerWrapper.style.setProperty("--hud-tabs-offset-x", `${config.statusHUD.tabsOffsetX}px`);
        innerWrapper.style.setProperty("--hud-tabs-offset-y", `${config.statusHUD.tabsOffsetY}px`);
        innerWrapper.style.setProperty("--hud-sleep-opacity", `${config.statusHUD.sleepOpacity}`);

        let tabsFadeTimer = null;
        const startFade = () => {
            clearTimeout(tabsFadeTimer);
            tabsFadeTimer = setTimeout(() => tabsBar.classList.add("faded"), Math.max(0, config.statusHUD.tabsFadeDelay || 0));
        };
        const stopFade = () => {
            clearTimeout(tabsFadeTimer);
            tabsBar.classList.remove("faded");
        };
        innerWrapper.addEventListener("mouseenter", stopFade);
        innerWrapper.addEventListener("mouseleave", startFade);
        startFade();

        if (bgImg && config.statusHUD.bgParallaxPx > 0) {
            const max = config.statusHUD.bgParallaxPx;
            const onMove = (e) => {
                const rect = innerWrapper.getBoundingClientRect();
                const px = (e.clientX - rect.left) / rect.width - 0.5;
                const py = (e.clientY - rect.top) / rect.height - 0.5;
                innerWrapper.style.setProperty("--hud-bg-parallax-x", `${px * max}px`);
                innerWrapper.style.setProperty("--hud-bg-parallax-y", `${py * max * 0.6}px`);
            };
            const onLeave = () => {
                innerWrapper.style.setProperty("--hud-bg-parallax-x", `0px`);
                innerWrapper.style.setProperty("--hud-bg-parallax-y", `0px`);
            };
            innerWrapper.addEventListener("mousemove", onMove);
            innerWrapper.addEventListener("mouseleave", onLeave);
        }

        const counterAPI = { set: (txt) => { tabConfig.textContent = `Setup${txt ? ` (${txt})` : ""}`; } };
        pokerHandGlobalState.hudElements = { counterAPI };
        pokerHandGlobalState.updateCounter = () => {
            const p = pokerHandGlobalState.persistedState || { selectedItems: [], confirmed: false };
            if (p.confirmed) counterAPI.set("Confirmed");
            else counterAPI.set(`Selected ${p.selectedItems.length}/5`);
        };
        pokerHandGlobalState.updateCounter();

        const performUpdate = async () => {
            const { persistedState, actor } = pokerHandGlobalState;
            const domainCards = actor.items.filter(i => (i.type || "").toLowerCase() === "domaincard");
            const updates = [];
            for (const card of domainCards) {
                const isSelected = persistedState.selectedItems.includes(card.id);
                const shouldBeInVault = !isSelected;
                if (card.system.inVault !== shouldBeInVault) updates.push({ _id: card.id, "system.inVault": shouldBeInVault });
            }
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
            ensureDeckFaceDownIfCollapsed();
        };

        const animateUnselectedFlyAway = async () => {
            const container = document.getElementById("poker-hand-container"); if (!container) return;
            const cards = Array.from(container.querySelectorAll(".poker-card"))
                .filter(c => (c.dataset.type || "") === "domaincard" && !c.classList.contains("selected"));
            if (!cards.length) return;
            cards.forEach(c => c.classList.add("face-down"));
            setTimeout(() => {
                cards.forEach((card, i) => {
                    const x = parseFloat(card.dataset.xOffset) || 0, y = parseFloat(card.dataset.yOffset) || 0, r = parseFloat(card.dataset.rotation) || 0;
                    const fx = (Math.random() * 240 - 120), fy = -(window.innerHeight * 0.8 + Math.random() * 100), fr = (Math.random() * 40 - 20);
                    card.style.zIndex = 10000 + i; const oldTrans = card.style.transition; card.dataset._oldTransition = oldTrans || "";
                    card.style.transition = "transform 800ms cubic-bezier(.2,.7,.1,1), opacity 800ms ease";
                    requestAnimationFrame(() => { card.style.opacity = "0"; card.style.transform = `translateX(${x + fx}px) translateY(${y + fy}px) rotateZ(${r + fr}deg) scale(0.9)`; });
                });
            }, 120);
            await new Promise(res => setTimeout(res, 850));
            cards.forEach(card => { card.style.transition = card.dataset._oldTransition || ""; card.dataset._oldTransition = ""; });
        };

        tabConfirm.addEventListener("click", async () => {
            SFX.play(SFX.click);
            const p = pokerHandGlobalState.persistedState;
            ui.notifications.info("Updating character configuration...");
            await animateUnselectedFlyAway();
            await performUpdate();
            p.confirmed = true; pokerHandGlobalState.saveState?.();
            counterAPI.set("Confirmed");
            pokerHandGlobalState.renderHand("config");
        });
        tabReset.addEventListener("click", async () => {
            SFX.play(SFX.click);
            ui.notifications.info("Resetting hand configuration...");
            const { actor } = pokerHandGlobalState;
            const domainCards = actor.items.filter(i => (i.type || "").toLowerCase() === "domaincard");
            const updates = domainCards.map(card => ({ _id: card.id, "system.inVault": true }));
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
            localStorage.removeItem(`pokerHandState_${actor.id}`);
            pokerHandGlobalState.cleanup();
            displayItemsAsPokerHand();
        });
        tabConfig.addEventListener("click", () => { SFX.play(SFX.click); pokerHandGlobalState.renderHand("config"); });
        tabItems.addEventListener("click", () => { SFX.play(SFX.click); pokerHandGlobalState.renderHand("items"); });
        tabFeat.addEventListener("click", () => { SFX.play(SFX.click); pokerHandGlobalState.renderHand("features"); });

        requestAnimationFrame(recenterHUDColumns);
        applyGlobalCollapse();
    }
    
    /* —— Render Hand Function —— */
    const renderHand = pokerHandGlobalState.renderHand = (handType = "config") => {
        document.getElementById("poker-hand-container")?.remove();
        document.querySelector(".poker-card-tooltip")?.remove();

        let visibleStartIndex = 0, allCardElements = [], retractTimer = null;
        const items = pokerHandGlobalState.actor.items.filter(i => !!i.actor && i.isOwner);

        let itemsToDisplay;
        const isConfigHand = handType === "config";
        const isConfirmed = !!pokerHandGlobalState.persistedState.confirmed;
        if (isConfigHand) {
            if (isConfirmed) itemsToDisplay = items.filter(it => (it.type || "").toLowerCase() === "domaincard" && !it.system.inVault);
            else itemsToDisplay = items.filter(it => (it.type || "").toLowerCase() === "domaincard");
        } else if (handType === "items") {
            const track = ["loot", "consumable", "weapon"];
            itemsToDisplay = items.filter(it => { const t = (it.type || "").toLowerCase(); if (t === "weapon") return it.system?.equipped; return track.includes(t); });
        } else if (handType === "features") {
            itemsToDisplay = items.filter(it => (it.type || "").toLowerCase() === "feature");
        } else itemsToDisplay = [];

        if ((isConfigHand || handType === 'domaincard')) {
            itemsToDisplay.sort((a, b) => (a.system?.level || 0) - (b.system?.level || 0));
        } else {
            itemsToDisplay.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
        }

        const tooltipElement = document.createElement("div");
        if (config.tooltip.enabled) { tooltipElement.className = "poker-card-tooltip"; document.body.appendChild(tooltipElement); }

        const container = document.createElement("div");
        container.id = "poker-hand-container";
        container.dataset.handType = handType;
        container.dataset.legendary = config.legendaryGlowStyle || "classic";
        container.dataset.legendaryEnabled = config.legendaryGlowEnabled ? "1" : "0";
        container.style.setProperty("--card-name-font-size", config.cardVisuals.nameStyle.fontSize);
        container.style.setProperty("--card-name-weight", config.cardVisuals.nameStyle.weight);
        container.style.setProperty("--card-name-stroke", config.cardVisuals.nameStyle.stroke);
        container.style.setProperty("--card-name-letter", config.cardVisuals.nameStyle.letter);

        const collapsedNow = getGlobalCollapsed();
        Object.assign(container.style, {
            bottom: collapsedNow ? config.handHeights.inactive : config.handHeights.active,
            left: "50%", transform: "translateX(-50%)",
            display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "auto", height: config.handHeights.active
        });

        const setDeckSleepLocal = () => container.querySelectorAll(".poker-card").forEach(c => c.classList.add("face-down"));
        const setDeckWakeLocal = () => { if (getGlobalCollapsed()) return; container.querySelectorAll(".poker-card").forEach(c => c.classList.remove("face-down")); };
        pokerHandGlobalState.deckSleep = setDeckSleepLocal;
        pokerHandGlobalState.deckWake = setDeckWakeLocal;

        const startRetractTimer = () => { clearTimeout(retractTimer); retractTimer = setTimeout(() => { if (container) { container.style.bottom = config.handHeights.inactive; setDeckSleepLocal(); } }, config.handHeights.retractDelay); };
        const cancelRetractTimer = () => { clearTimeout(retractTimer); retractTimer = null; if (container) container.style.bottom = config.handHeights.active; setDeckWakeLocal(); };
        pokerHandGlobalState.startRetractTimer = startRetractTimer; pokerHandGlobalState.cancelRetractTimer = cancelRetractTimer;

        container.addEventListener("mouseenter", () => { if (!getGlobalCollapsed()) cancelRetractTimer(); });
        container.addEventListener("mouseleave", startRetractTimer);

        const hudEl = document.getElementById("status-hud-container");
        if (hudEl && !hudEl.dataset._phhHoverBound) {
            hudEl.addEventListener("mouseenter", () => { if (!getGlobalCollapsed()) cancelRetractTimer(); });
            hudEl.addEventListener("mouseleave", startRetractTimer);
            hudEl.dataset._phhHoverBound = "1";
        }

        async function smartPlaceTooltip(card, item) {
            if (!config.tooltip.enabled || !(item.system?.description?.value || item.system?.description)) return;
            const cardRect = card.getBoundingClientRect();
            const description = item.system.description.value || item.system.description;

            tooltipElement.innerHTML = await TextEditor.enrichHTML(description, { async: true });
            tooltipElement.style.opacity = "1";

            await new Promise(resolve => setTimeout(resolve, 0));

            const tipRect = tooltipElement.getBoundingClientRect();
            const edge = 10, gapTop = Math.max(config.tooltip.offsetY, Math.round(cardRect.height * 0.18)), sideGap = 16;
            let left = cardRect.left + (cardRect.width - tipRect.width) / 2;
            left = Math.max(edge, Math.min(left, window.innerWidth - tipRect.width - edge));
            let top = cardRect.top - tipRect.height - gapTop;
            if (top < edge) {
                const canRight = (window.innerWidth - cardRect.right - sideGap) >= tipRect.width;
                const canLeft = (cardRect.left - sideGap) >= tipRect.width;
                if (canRight || canLeft) {
                    top = Math.max(edge, Math.min(window.innerHeight - tipRect.height - edge, cardRect.top + (cardRect.height - tipRect.height) / 2));
                    left = canRight ? Math.min(window.innerWidth - tipRect.width - edge, cardRect.right + sideGap) : Math.max(edge, cardRect.left - tipRect.width - sideGap);
                } else {
                    top = cardRect.bottom + gapTop;
                    top = Math.min(top, window.innerHeight - tipRect.height - edge);
                }
            }
            tooltipElement.style.left = `${Math.round(left)}px`;
            tooltipElement.style.top = `${Math.round(top)}px`;
        }

        function attachHoverEvents(card, item) {
            const base = (cx, cy, rot) => `translateX(${cx}px) translateY(${cy}px) rotateZ(${rot}deg)`;
            const toNum = (v) => Number.parseFloat(v) || 0;
            let raf = null;
            const onMouseMove = (ev) => {
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                    const rect = card.getBoundingClientRect();
                    const px = (ev.clientX - rect.left) / rect.width;
                    const py = (ev.clientY - rect.top) / rect.height;
                    const dx = (px - 0.5) * 2;
                    const dy = (py - 0.5) * 2;
                    const tilt = config.interactiveHover.tiltMax || 0;
                    const x = toNum(card.dataset.xOffset), y = toNum(card.dataset.yOffset), r = toNum(card.dataset.rotation);
                    const sc = config.interactiveHover.scale, liftY = y + config.interactiveHover.lift;
                    const rx = -(dy * tilt);
                    const ry = dx * tilt;
                    card.style.transform = `perspective(1200px) ${base(x, liftY, r)} rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`;
                });
            };

            card.addEventListener("mouseenter", () => {
                if (getGlobalCollapsed()) return;
                SFX.play(SFX.hover);
                const x = toNum(card.dataset.xOffset), y = toNum(card.dataset.yOffset), r = toNum(card.dataset.rotation);
                const sc = config.interactiveHover.scale, liftY = y + config.interactiveHover.lift;
                card.style.zIndex = 9999;
                card.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.55)) brightness(1.04)";
                card.style.transform = `perspective(1200px) ${base(x, liftY, r)} scale(${sc})`;
                setDeckWakeLocal();
                smartPlaceTooltip(card, item);
                card.addEventListener("mousemove", onMouseMove);
            });
            card.addEventListener("mousemove", () => { if (config.tooltip.enabled) smartPlaceTooltip(card, item); });
            card.addEventListener("mouseleave", () => {
                if (raf) {
                    cancelAnimationFrame(raf);
                    raf = null;
                }
                const x = toNum(card.dataset.xOffset), y = toNum(card.dataset.yOffset), r = toNum(card.dataset.rotation);
                card.style.zIndex = card.dataset.originalZIndex || 0;
                card.style.transform = `${base(x, y, r)}`;
                card.style.filter = "";
                if (config.tooltip.enabled) tooltipElement.style.opacity = "0";
                card.removeEventListener("mousemove", onMouseMove);
            });
        }

        function arrangeCardsInFan(cards) {
            const visible = Array.from(cards).filter(card => card.style.display !== "none");
            const total = visible.length;
            visible.forEach((card, index) => {
                const ni = index - (total - 1) / 2.0;
                const { spacing, arcHeight, rotationFactor } = config.handLayout;
                const x = ni * spacing;
                const y = Math.abs(ni) * (Math.abs(ni) * arcHeight);
                const r = ni * rotationFactor;
                Object.assign(card.style, { zIndex: index });
                card.dataset.xOffset = String(x);
                card.dataset.yOffset = String(y);
                card.dataset.rotation = String(r);
                card.dataset.originalZIndex = String(index);
                card.style.transform = `translateX(${x}px) translateY(${y}px) rotateZ(${r}deg)`;
            });
        }

        function updateHandView() {
            const maxStart = Math.max(0, allCardElements.length - config.handLayout.maxVisibleCards);
            if (visibleStartIndex > maxStart) visibleStartIndex = maxStart;
            if (visibleStartIndex < 0) visibleStartIndex = 0;
            allCardElements.forEach((card, idx) => { card.style.display = (idx >= visibleStartIndex && idx < visibleStartIndex + config.handLayout.maxVisibleCards) ? "block" : "none"; });
            arrangeCardsInFan(container.querySelectorAll(".poker-card"));
        }

        function animateEntranceStronger() {
            if (getGlobalCollapsed()) {
                updateHandView();
                setDeckSleepLocal();
                container.style.bottom = config.handHeights.inactive;
                return;
            }
            updateHandView();
            setDeckSleepLocal();
            const visible = Array.from(container.querySelectorAll(".poker-card")).filter(c => c.style.display !== "none");
            arrangeCardsInFan(visible);
            visible.forEach((card, index) => {
                const x = Number.parseFloat(card.dataset.xOffset) || 0;
                const y = Number.parseFloat(card.dataset.yOffset) || 0;
                const r = Number.parseFloat(card.dataset.rotation) || 0;
                card.style.opacity = "0";
                card.style.transform = `translateX(${x}px) translateY(${y + 160}px) rotateZ(${r}deg) scale(0.9)`;
                setTimeout(() => {
                    card.style.opacity = "1";
                    card.style.transition = "transform 420ms cubic-bezier(.2,1.2,.2,1), opacity .25s ease";
                    card.style.transform = `translateX(${x}px) translateY(${y - 8}px) rotateZ(${r}deg) scale(1.03)`;
                    setTimeout(() => {
                        card.style.transform = `translateX(${x}px) translateY(${y}px) rotateZ(${r}deg) scale(1)`;
                        card.style.transition = "";
                    }, 420);
                }, (index + 1) * config.animations.entranceDelay);
            });
            setTimeout(() => {
                const dust = document.createElement("div"); dust.className = "sparkle-layer";
                container.appendChild(dust);
                for (let i = 0; i < 14; i++) {
                    const s = document.createElement("div"); s.className = "sparkle";
                    s.style.left = `${(Math.random() * 900) + 100}px`; s.style.bottom = `${Math.random() * 10}px`;
                    s.style.width = s.style.height = `${2 + Math.random() * 3}px`;
                    s.style.setProperty("--dx", `${(Math.random() - 0.5) * 22}px`);
                    s.style.setProperty("--dur", `${0.6 + Math.random() * 0.6}s`);
                    s.style.setProperty("--sc", `${0.6 + Math.random() * 0.5}`);
                    dust.appendChild(s);
                    s.addEventListener("animationend", () => s.remove());
                }
                setTimeout(() => dust.remove(), 1200);
            }, visible.length * config.animations.entranceDelay + 180);
        }

        function createCardElement(item) {
            const isDomain = (item.type || "").toLowerCase() === "domaincard";
            const card = document.createElement("div");
            card.className = "poker-card face-down";
            card.dataset.itemId = item.id;
            card.dataset.type = (item.type || "").toLowerCase();

            const art = document.createElement("div");
            art.className = "card-art"; art.style.backgroundImage = `url('${item.img || ""}')`; card.appendChild(art);

            const back = document.createElement("div");
            back.className = "card-back";
            card.appendChild(back);

            const shine = document.createElement("div"); shine.className = "shine"; card.appendChild(shine);

            const textOverlay = document.createElement("div"); textOverlay.className = "card-text-overlay";
            const level = document.createElement("div"); level.className = "card-level";
            if (isDomain) { const il = item.system?.level; if (il != null) level.textContent = il; }
            textOverlay.appendChild(level);

            const nameContainer = document.createElement("div"); nameContainer.className = "card-name-container";
            const uniqueId = `name-curve-${item.id}`; const arc = config.cardVisuals.nameStyle.arc ?? 10;
            const fullName = (item.name || "");
            nameContainer.innerHTML = `<svg class="card-name-svg" viewBox="0 0 180 40">
        <path id="${uniqueId}" fill="none" d="M 10,30 Q 90,${arc} 170,30" />
        <text><textPath class="text-path" href="#${uniqueId}" startOffset="50%" text-anchor="middle">${foundry.utils.escapeHTML(fullName)}</textPath></text>
        </svg>`;
            textOverlay.appendChild(nameContainer);
            card.appendChild(textOverlay);

            const isSmallHand = (container.dataset.handType === "config") && !!pokerHandGlobalState.persistedState.confirmed && isDomain;
            if (isSmallHand) card.classList.add("legendary");

            const isCfg = (container.dataset.handType === "config") && !pokerHandGlobalState.persistedState.confirmed;
            if (isCfg) {
                card.classList.add("selectable");
                const badge = document.createElement("div"); badge.className = "select-badge"; badge.textContent = "✓"; card.appendChild(badge);
                const underline = document.createElement("div"); underline.className = "select-underline"; card.appendChild(underline);
            }
            if (isCfg && pokerHandGlobalState.persistedState.selectedItems.includes(item.id)) {
                card.classList.add("selected");
            }

            card.addEventListener("click", () => { SFX.play(SFX.click); item.sheet?.render(true); });

            card.addEventListener("contextmenu", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isCfg && isDomain) {
                    SFX.play(SFX.click);
                    const sel = pokerHandGlobalState.persistedState.selectedItems;
                    const idx = sel.indexOf(item.id);
                    if (idx > -1) { sel.splice(idx, 1); card.classList.remove("selected"); }
                    else {
                        if (sel.length >= 5) return ui.notifications.warn("You can select a maximum of 5 cards!");
                        sel.push(item.id); card.classList.add("selected");
                    }
                    pokerHandGlobalState.updateCounter?.(); pokerHandGlobalState.saveState?.();
                } else {
                    SFX.play(SFX.use);
                    await useItemAndChat(item, pokerHandGlobalState.actor, e);
                }
            });

            card.addEventListener("wheel", (event) => { event.preventDefault(); event.stopPropagation(); if (itemsToDisplay.length <= config.handLayout.maxVisibleCards) return; visibleStartIndex += (event.deltaY > 0 ? 1 : -1); updateHandView(); });

            return card;
        }

        const allCards = itemsToDisplay.map(createCardElement);
        allCards.forEach((card, i) => { container.appendChild(card); attachHoverEvents(card, itemsToDisplay[i]); });
        allCardElements = allCards;
        document.body.appendChild(container);
        setupSparkles(container);

        animateEntranceStronger();

        const duration = (Math.min(allCardElements.length, config.handLayout.maxVisibleCards) * config.animations.entranceDelay) + 700;
        setTimeout(() => { if (document.body.contains(container)) { container.style.bottom = config.handHeights.inactive; setDeckSleepLocal(); } }, duration);

        applyGlobalCollapse();
        ensureDeckFaceDownIfCollapsed();
    };

    /* —— CSS Injection —— */
    (function injectCSS() {
        const styleId = "poker-hand-styles";
        document.getElementById(styleId)?.remove();
        const { cardVisuals, statusHUD, hudLayout, tooltip } = config;
        const accent = statusHUD.borderColor || "#c0a060";
        const selGlow = config.selectedBorderColor || "#ff9900";

        const hudBgFallback = !statusHUD.backgroundImage
            ? `background-color: ${statusHUD.backgroundColor};
    border-top: 2px solid ${accent};
    box-shadow: 0 -5px 20px rgba(0,0,0,0.5);
    backdrop-filter: blur(8px);`
            : `background-color: transparent;`;

        const cardBaseStyle = cardVisuals.baseImage
            ? `background-image: url('${cardVisuals.baseImage}'); background-size: 100% 100%; border: none; box-shadow: none;`
            : `background: linear-gradient(160deg, #3a3a4a 0%, #202028 100%); border: 1px solid #777; border-radius: 12px; box-shadow: inset 0 0 1px 1px rgba(255,255,255,0.08);`;

        const cardBackStyle = cardVisuals.backImage
            ? `background-image: url('${cardVisuals.backImage}'); background-size: cover; background-position: center;`
            : `background: radial-gradient(circle, #4a4a5a, #2a2a3a), repeating-linear-gradient(-45deg, rgba(255,255,255,0.02), rgba(255,255,255,0.02) 2px, transparent 2px, transparent 6px); border: 1px solid rgba(200, 200, 255, 0.2); border-radius: 11px; box-sizing: border-box;`;

        const cardArtMaskStyle = cardVisuals.artMaskImage
            ? `mask-image: url('${cardVisuals.artMaskImage}'); -webkit-mask-image: url('${cardVisuals.artMaskImage}');`
            : `mask-image: linear-gradient(to bottom, black 0%, black 55%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 0%, black 55%, transparent 100%);`;

        const css = `
    .poker-card-tooltip { position: fixed; width: ${tooltip.width}; max-height: ${tooltip.maxHeight}; background-color: ${tooltip.backgroundColor}; border: 2px solid ${accent}; color: ${tooltip.textColor}; padding: 12px; border-radius: 8px; box-shadow: 0 0 15px rgba(0,0,0,0.6); z-index: 10000; pointer-events: none; opacity: 0; transition: opacity 0.2s ease-out; font-family: "Signika", sans-serif; font-size: 14px; line-height: 1.5; overflow: auto; }

    .poker-card { width: ${cardVisuals.width}px; height: ${cardVisuals.height}px; position: absolute; transition: transform 0.22s cubic-bezier(.2,.8,.2,1), opacity .2s ease, filter .2s ease; pointer-events: auto; cursor: pointer; filter: drop-shadow(3px 3px 5px rgba(0,0,0,0.5)); overflow: hidden; will-change: transform, filter; transform-style: preserve-3d; ${cardBaseStyle} }
    .card-back { position: absolute; inset: 0; z-index: 3; opacity: 0; transform: scale(0.985); transition: opacity .22s ease, transform .22s ease; pointer-events: none; ${cardBackStyle} }
    .poker-card .card-art { position: absolute; z-index: 2; background-color: ${cardVisuals.artBackgroundColor}; background-size: cover; background-position: center top; background-repeat: no-repeat; mask-size: 100% 100%; -webkit-mask-size: 100% 100%; left: 0; top: 0; width: 100%; height: 100%; transition: opacity .22s ease, transform .22s ease; ${cardArtMaskStyle} }
    .poker-card .card-text-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; transition: opacity .22s ease, transform .22s ease; }
    .poker-card.face-down .card-back { opacity: 1; transform: scale(1); }
    .poker-card.face-down .card-art, .poker-card.face-down .card-text-overlay { opacity: 0; transform: translateY(6px) scale(0.98); }

    .poker-card .shine { position: absolute; inset: -20% -30%; z-index: 4; pointer-events: none;
    background: linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 48%, rgba(255,255,255,0) 60%);
    transform: translateX(-160%) skewX(-12deg);
    opacity: 0; }
    .poker-card:hover .shine { animation: phh-shine 0.9s ease-out forwards; }
    @keyframes phh-shine { 0% { transform: translateX(-160%) skewX(-12deg); opacity: 0; } 25% { opacity: .8; } 100% { transform: translateX(160%) skewX(-12deg); opacity: 0; } }

    .card-level { position: absolute; top: 10px; left: 15px; font-family: "Modesto Condensed","Signika",sans-serif; font-size: 24px; font-weight: bold; color: white; text-shadow: 1.5px 0 0 black, -1.5px 0 0 black, 0 1.5px 0 black, 0 -1.5px 0 black; }
    .card-name-container { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; height: 50px; display: flex; align-items: center; justify-content: center; }
    .card-name-svg { width: 100%; height: 100%; overflow: visible; }
    .card-name-svg .text-path { font-family: "Signika", sans-serif; font-size: var(--card-name-font-size, ${cardVisuals.nameStyle.fontSize}); font-weight: var(--card-name-weight, ${cardVisuals.nameStyle.weight}); letter-spacing: var(--card-name-letter, ${cardVisuals.nameStyle.letter}); fill: white; stroke: black; stroke-width: var(--card-name-stroke, ${cardVisuals.nameStyle.stroke}); }

    #status-hud-container { position: fixed; bottom: 0; left: 0; width: 100%; z-index: 7000; font-family: "Signika", sans-serif; display: flex; justify-content: center; pointer-events: none; padding: 0 15px; box-sizing: border-box; }
    #status-hud-inner-wrapper { position: relative; display: grid; place-items: center; width: 100%; max-width: ${hudLayout.hudMaxWidth}; height: ${hudLayout.hudHeight}; padding: 6px 12px; border-radius: 14px 14px 0 0; pointer-events: auto; ${hudBgFallback}; overflow: visible;
    --hud-tabs-offset-x: 0px; --hud-tabs-offset-y: 0px; --hud-content-offset-y: 0px; --hud-tabs-fade-opacity: .25; --hud-sleep-opacity: 0; }

    #hud-bg-img { position: absolute; left: 50%; bottom: 0;
    transform:
    translateX(calc(-50% + var(--hud-bg-parallax-x, 0px)))
    translateY(calc(var(--hud-bg-offset-y, 0px) + var(--hud-bg-parallax-y, 0px)))
    scaleX(var(--hud-bg-scale-x, 1)) scaleY(var(--hud-bg-scale-y, 1));
    transform-origin: center bottom;
    width: calc(100% * var(--hud-bg-scale-x, 1));
    height: calc(100% * var(--hud-bg-scale-y, 1));
    object-fit: fill;
    transition: transform .28s ease, opacity .28s ease;
    pointer-events: none; z-index: 0; }
    #status-hud-inner-wrapper > *:not(#hud-bg-img) { position: relative; z-index: 1; }

    #hud-tabs-bar { position: absolute; bottom: calc(100% - 4px); left: 50%;
    transform: translate(calc(-50% + var(--hud-tabs-offset-x, 0px)), var(--hud-tabs-offset-y, 0px));
    display: flex; gap: 8px; z-index: 2; pointer-events: auto; transition: opacity .25s ease; }
    #hud-tabs-bar.faded { opacity: var(--hud-tabs-fade-opacity, 0.25); }
    .hud-tab { position: relative; padding: 4px 8px; background: linear-gradient(180deg, ${hexToRgba(accent,0.9)}, ${hexToRgba(accent,0.6)});
    border: 1px solid ${hexToRgba(accent,0.9)}; color: #fff; border-radius: 8px 8px 0 0; box-shadow: 0 4px 10px rgba(0,0,0,0.35);
    font-size: ${hudLayout.buttonFontSize}; cursor: pointer; user-select: none; white-space: nowrap; }

    .hud-main-panel { display: grid; grid-template-columns: minmax(0,1fr) max-content minmax(0,1fr); align-items: center; justify-items: stretch; width: 100%; padding: 4px 8px; transform: translateY(var(--hud-content-offset-y, 0px)); }

    .status-hud-column { display: flex; flex-direction: column; gap: var(--phh-row-gap, ${hudLayout.rowGap}); justify-content: center; min-width: ${hudLayout.sidePanelWidth}; }
    .status-hud-column.left { align-items: flex-end; }
    .status-hud-column.right { align-items: flex-start; }

    .status-hud-center { display: flex; flex-direction: column; align-items: center; text-align: center; transform: translateX(var(--phh-center-shift, 0px)); transition: transform .15s ease; gap: 2px; }

    .status-hud-token-wrapper {
    position: relative;
    width: ${config.statusHUD.tokenStyle.size};
    height: ${config.statusHUD.tokenStyle.size};
    display: grid;
    place-items: center;
    background-size: 100% 100%;
    cursor: pointer;
    }
    .status-hud-token-img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 2px solid white;
    object-fit: cover;
    box-sizing: border-box;
    }

    .char-name { font-weight: 700; color: #fff; font-size: var(--phh-name-font, ${config.statusHUD.infoStyle.nameSize}); line-height: 1.15; }
    .character-info-bar .char-class { color: #fff; opacity: .9; font-size: var(--phh-class-font, ${config.statusHUD.infoStyle.classSize}); white-space: nowrap; }

    .tracker-wrapper { position: relative; }
    .resource-tracker { display: flex; align-items: center; gap: 6px; }
    .resource-tracker .label { color: ${statusHUD.labelColor}; font-size: var(--phh-label-font, ${hudLayout.labelFontSize}); cursor: pointer; user-select: none; padding: 1px 4px; border-radius: 4px; transition: background-color .15s; line-height: 1.2; }
    .resource-tracker .label:hover { background: ${hexToRgba(accent,0.15)}; }
    .tracker-panel { position: absolute; right: calc(100% + 6px); top: 50%; transform: translateY(-50%) scale(0.96); transform-origin: right center; background: ${statusHUD.backgroundImage ? hexToRgba("#000000",0.45) : statusHUD.backgroundColor}; border: 1px solid ${statusHUD.borderColor}; border-radius: 8px; padding: 6px 8px; display: flex; gap: 6px; opacity: 0; pointer-events: none; transition: transform .16s ease, opacity .16s ease; white-space: nowrap; z-index: 5; }
    .tracker-panel.open { opacity: 1; transform: translateY(-50%) scale(1); pointer-events: auto; }

    .crystal { width: 22px; height: 24px; position: relative; transition: transform .15s ease, filter .2s ease; cursor: pointer; }
    .crystal:hover { transform: scale(1.12); filter: brightness(1.06); }
    .crystal svg { width: 100%; height: 100%; }
    .crystal .hex { stroke-width: 2px; }
    .crystal.hp .hex { stroke: ${statusHUD.dotFilledHP}; fill: ${hexToRgba(statusHUD.dotFilledHP, 0.18)}; }
    .crystal.stress .hex { stroke: ${statusHUD.dotFilledStress}; fill: ${hexToRgba(statusHUD.dotFilledStress, 0.18)}; }
    .crystal.hope .hex { stroke: ${statusHUD.dotFilledHope}; fill: ${hexToRgba(statusHUD.dotFilledHope, 0.18)}; }
    .crystal.armor .hex { stroke: ${statusHUD.dotFilledArmor}; fill: ${hexToRgba(statusHUD.dotFilledArmor, 0.18)}; }
    .crystal.filled.hp .hex { fill: ${hexToRgba(statusHUD.dotFilledHP, 0.7)}; }
    .crystal.filled.stress .hex{ fill: ${hexToRgba(statusHUD.dotFilledStress, 0.7)}; }
    .crystal.filled.hope .hex { fill: ${hexToRgba(statusHUD.dotFilledHope, 0.7)}; }
    .crystal.filled.armor .hex { fill: ${hexToRgba(statusHUD.dotFilledArmor, 0.7)}; }
    .crystal .shine { opacity: 0; transition: opacity .2s ease; }
    .crystal.filled .shine { opacity: 0.85; }

    .static-stat { display: flex; align-items: center; justify-content: space-between; gap: 6px; white-space: nowrap; line-height: 1.2; }
    .static-stat .label { color: ${statusHUD.labelColor}; font-size: var(--phh-label-font, ${hudLayout.labelFontSize}); }
    .static-stat .value { color: ${statusHUD.textColor}; font-size: var(--phh-value-font, ${hudLayout.valueFontSize}); font-weight: 700; }

    #status-hud-container[data-fold-hud="1"].collapsed #hud-tabs-bar,
    #status-hud-container[data-fold-hud="1"].collapsed .hud-main-panel {
    opacity: 0; transform: translateY(calc(var(--hud-content-offset-y, 0px) + 12px)); pointer-events: none; transition: opacity .2s ease, transform .2s ease; }
    #status-hud-container[data-fold-hud="1"].collapsed #hud-bg-img { transform:
    translateX(calc(-50% + var(--hud-bg-parallax-x, 0px)))
    translateY(calc(var(--hud-bg-offset-y, 0px) + var(--hud-bg-parallax-y, 0px)))
    scaleX(var(--hud-bg-scale-x, 1)) scaleY(0); opacity: 0; }
    #status-hud-container.collapsed #status-hud-inner-wrapper { opacity: var(--hud-sleep-opacity, 0); pointer-events: none; transition: opacity .25s ease; }

    #poker-hand-container.collapsed { bottom: -9999px !important; pointer-events: none; }

    #poker-hand-container { position: fixed; left: 50%; transform: translateX(-50%); z-index: 3500; display: flex; justify-content: center; align-items: center; pointer-events: auto; height: ${config.handHeights.active}; transition: bottom 0.45s cubic-bezier(.2,1,.2,1); overflow: visible; }

    .sparkle-layer { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 1100px; height: 260px; pointer-events: none; z-index: 1; overflow: visible; }
    .sparkle { position: absolute; opacity: 0; filter: saturate(1.1); animation: spark-float-fade var(--dur,1.8s) ease-out forwards; mix-blend-mode: screen; }
    .sparkle.text { width: auto !important; height: auto !important; background: none !important; border-radius: 0 !important; line-height: 1; white-space: pre; }
    .sparkle.runes { font-weight: 700; }
    .sparkle.petals { filter: saturate(1.2); }
    .sparkle.butterflies { filter: saturate(1.3); }
    .sparkle.notes { font-weight: 700; }
    .sparkle.cards { font-weight: 900; }

    @keyframes spark-float-fade {
    0% { opacity: 0; transform: translateX(var(--dx,0px)) translateY(18px) rotate(var(--rot,0deg)) scale(var(--sc,0.9)); }
    10% { opacity: 1; }
    80% { opacity: 0.95; }
    100% { opacity: 0; transform: translateX(var(--dx,0px)) translateY(-42px) rotate(var(--rot,0deg)) scale(var(--sc,1.1)); }
    }

    #hud-bookmark-toggle { position: fixed; left: 0; top: var(--bookmark-top, 33vh); transform: translateY(-50%); width: 32px; height: 120px; border-radius: 0 8px 8px 0; background: linear-gradient(180deg, rgba(60,45,30,0.95), rgba(30,20,10,0.95)); border: 1px solid ${hexToRgba(statusHUD.borderColor,0.55)}; box-shadow: 0 4px 12px rgba(0,0,0,0.45), inset 0 0 10px ${hexToRgba(statusHUD.borderColor,0.15)}; z-index: 9000; display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; color: #f0e6d2; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
    #hud-bookmark-toggle .tab-label { font-size: 10px; letter-spacing: 1px; writing-mode: vertical-rl; transform: rotate(180deg); opacity: .9; }
    #hud-bookmark-toggle .chev { position: absolute; bottom: 6px; font-size: 12px; opacity: .8; }
    #hud-bookmark-toggle.collapsed .chev { transform: rotate(180deg); }

    .poker-card .select-badge {
    position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border-radius: 50%;
    background: ${selGlow}; color: #111; font-weight: 900; font-size: 14px; line-height: 20px; text-align: center;
    box-shadow: 0 0 6px ${hexToRgba(selGlow,0.8)}, 0 0 16px ${hexToRgba(selGlow,0.5)};
    opacity: 0; transform: scale(0.5); transition: all .15s ease; pointer-events: none; z-index: 6;
    }
    .poker-card .select-underline {
    position: absolute; left: 12px; right: 12px; bottom: 10px; height: 4px; border-radius: 4px;
    background: linear-gradient(90deg, ${hexToRgba(selGlow,0.2)}, ${selGlow}, ${hexToRgba(selGlow,0.2)});
    opacity: 0; transform: translateY(6px); transition: all .18s ease; z-index: 6;
    }
    .poker-card.selectable.selected .select-badge { opacity: 1; transform: scale(1); }
    .poker-card.selectable.selected .select-underline { opacity: 1; transform: translateY(0); }

    [data-legendary-enabled="1"] .poker-card.face-down.legendary .card-back::before,
    [data-legendary-enabled="1"] .poker-card.face-down.legendary .card-back::after { content:""; position:absolute; inset:-8px; border-radius: 14px; pointer-events:none; opacity: 0.9; z-index: 8; }

    [data-legendary="classic"] .poker-card.face-down.legendary .card-back::before {
    background: conic-gradient(from 0deg, rgba(255,230,160,0.0), rgba(255,230,160,0.85), rgba(255,230,160,0));
    filter: blur(6px); animation: phh-legend-rotate 4s linear infinite;
    }
    [data-legendary="classic"] .poker-card.face-down.legendary .card-back::after {
    border:2px solid rgba(255,215,130,0.95); box-shadow: 0 0 18px rgba(255,210,120,0.95), 0 0 40px rgba(255,210,120,0.6);
    }

    [data-legendary="halo"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(closest-side, rgba(255,230,170,0.7), rgba(255,230,170,0.15) 60%, rgba(255,230,170,0) 75%);
    filter: blur(10px); animation: phh-legend-pulse 2.4s ease-in-out infinite;
    }
    [data-legendary="halo"] .poker-card.face-down.legendary .card-back::after {
    border:1.5px solid rgba(255,225,160,0.8); box-shadow: 0 0 14px rgba(255,220,150,0.7);
    }

    [data-legendary="rays"] .poker-card.face-down.legendary .card-back::before {
    background: repeating-conic-gradient(from 0deg, #fff0 0deg 10deg, #ffd77fbf 12deg 16deg);
    filter: blur(4px) brightness(1.1); animation: phh-legend-rotate 6s linear infinite;
    }
    [data-legendary="rays"] .poker-card.face-down.legendary .card-back::after {
    border:1.5px solid rgba(255,230,160,0.9); box-shadow: 0 0 16px rgba(255,220,150,0.8), inset 0 0 10px rgba(255,240,220,0.25);
    }

    [data-legendary="prism"] .poker-card.face-down.legendary .card-back::before {
    background: conic-gradient(from 0deg, #ffe18c, #ffb496, #b4d2ff, #b4ffd2, #ffe18c);
    filter: blur(8px) saturate(1.2); animation: phh-legend-rotate 5.2s linear infinite;
    }
    [data-legendary="prism"] .poker-card.face-down.legendary .card-back::after {
    border:2px solid rgba(255,245,230,0.9); box-shadow: 0 0 22px rgba(255,235,200,0.9), 0 0 40px rgba(200,220,255,0.65);
    }

    [data-legendary="runes"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(closest-side, #fff0d214, #fff0d200 60%), repeating-conic-gradient(from 0deg, #fff0 0deg 8deg, #ffe6a6cc 9deg 12deg);
    filter: blur(5px); animation: phh-legend-rotate 8s linear infinite;
    }
    [data-legendary="runes"] .poker-card.face-down.legendary .card-back::after {
    border:1.5px solid rgba(255,235,200,0.85); box-shadow: 0 0 14px rgba(255,230,180,0.7);
    }

    [data-legendary="embers"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(closest-side, #ffbe78d9, #ff8c4600 70%);
    filter: blur(10px) brightness(1.05); animation: phh-legend-flicker 1.6s ease-in-out infinite;
    }
    [data-legendary="embers"] .poker-card.face-down.legendary .card-back::after {
    border:1.5px solid rgba(255,160,90,0.9); box-shadow: 0 0 18px rgba(255,140,70,0.9), 0 0 34px rgba(255,120,60,0.6);
    }

    [data-legendary="holy"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(circle, #ffffff 0%, #fffde0 40%, #fff8c000 70%);
    filter: blur(8px); animation: phh-legend-pulse 2.8s ease-in-out infinite;
    }
    [data-legendary="holy"] .poker-card.face-down.legendary .card-back::after {
    border: 2px solid #fff8e1; box-shadow: 0 0 25px #fff, 0 0 50px #fff8e1;
    }

    [data-legendary="unholy"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(circle, #d0b0ff 0%, #9400d3 40%, #8a2be200 70%);
    filter: blur(12px) brightness(1.2); animation: phh-legend-flicker 1.2s linear infinite reverse;
    }
    [data-legendary="unholy"] .poker-card.face-down.legendary .card-back::after {
    border: 2px solid #ab82ff; box-shadow: 0 0 20px #9400d3, 0 0 40px #8a2be2, inset 0 0 10px #4b0082;
    }

    [data-legendary="ice"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(circle, #e0ffff 0%, #afeeee 50%, #add8e600 75%);
    filter: blur(6px); animation: phh-legend-ice-shimmer 3.5s ease-in-out infinite;
    }
    [data-legendary="ice"] .poker-card.face-down.legendary .card-back::after {
    border: 2px solid #b0e0e6; box-shadow: 0 0 15px #afeeee, 0 0 30px #add8e6, inset 0 0 15px #e0ffff66;
    clip-path: polygon(0% 10px, 10px 0%, calc(100% - 10px) 0%, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0% calc(100% - 10px));
    }

    [data-legendary="vortex"] .poker-card.face-down.legendary .card-back::before {
    background: conic-gradient(from 0deg at 50% 50%, #4a00e0, #8e2de2, #4a00e0);
    filter: blur(10px); animation: phh-legend-rotate 3s linear infinite;
    }
    [data-legendary="vortex"] .poker-card.face-down.legendary .card-back::after {
    border: 2px solid #c39eff; box-shadow: 0 0 20px #8e2de2, inset 0 0 25px #4a00e0;
    }

    [data-legendary="electric"] .poker-card.face-down.legendary .card-back::before {
    background: radial-gradient(circle, #f0f8ff, #87cefa, #1e90ff00 70%);
    filter: blur(5px); animation: phh-legend-flicker 0.2s linear infinite;
    }
    [data-legendary="electric"] .poker-card.face-down.legendary .card-back::after {
    border: 2px solid #6495ed; box-shadow: 0 0 20px #1e90ff;
    animation: phh-legend-electric-crackle 1.5s linear infinite;
    }

    #poker-hand-container[data-legendary="none"] .poker-card.face-down.legendary .card-back::before,
    #poker-hand-container[data-legendary="none"] .poker-card.face-down.legendary .card-back::after,
    #poker-hand-container[data-legendary-enabled="0"] .poker-card.face-down.legendary .card-back::before,
    #poker-hand-container[data-legendary-enabled="0"] .poker-card.face-down.legendary .card-back::after { display: none; }

    @keyframes phh-legend-rotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes phh-legend-pulse { 0%,100% { opacity: 0.65; transform: scale(0.98); } 50% { opacity: 1.0; transform: scale(1.03); } }
    @keyframes phh-legend-flicker { 0%{opacity:.55} 25%{opacity:.9} 50%{opacity:.65} 75%{opacity:1} 100%{opacity:.6} }
    @keyframes phh-legend-ice-shimmer { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; filter: blur(6px) brightness(1.2); } }
    @keyframes phh-legend-electric-crackle {
    0% { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
    5% { clip-path: polygon(0 0, 80% 0, 100% 20%, 100% 100%, 20% 100%, 0 80%); }
    10% { clip-path: polygon(20% 0, 100% 0, 80% 100%, 0 100%); }
    15% { clip-path: polygon(0 20%, 100% 0, 100% 80%, 0 100%); }
    20% { clip-path: polygon(0 0, 100% 20%, 100% 100%, 0 80%); }
    100% { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
    }
    `;
        const style = document.createElement("style");
        style.id = styleId; style.innerHTML = css; document.head.appendChild(style);
    })();
    
    /* —— Per-Actor State —— */
    const actorId = actor.id;
    const storageKey = `pokerHandState_${actorId}`;
    let persistedState = {};
    try { const s = localStorage.getItem(storageKey); if (s) persistedState = JSON.parse(s); } catch (e) { console.warn("Could not restore state", e); }
    const defaultState = { selectedItems: [], confirmed: false };
    persistedState = { ...defaultState, ...persistedState };
    pokerHandGlobalState.persistedState = persistedState;
    pokerHandGlobalState.saveState = () => { try { localStorage.setItem(storageKey, JSON.stringify(pokerHandGlobalState.persistedState)); } catch (e) { console.warn("Could not save state", e); } };

    // =======================================================
    //  Execution Logic
    // =======================================================
    
    createStatusHUD(actor);

    const hookRecords = [];
    const addHook = (event, fn) => hookRecords.push({ event, id: Hooks.on(event, fn) });

    addHook("updateActor", (updActor) => {
        if (updActor.id !== actor.id) return;
        createStatusHUD(updActor);
        recenterHUDColumns();
        ensureDeckFaceDownIfCollapsed();
    });
    addHook("updateItem", (item, changed) => {
        if (item.actor?.id !== actor.id) return;
        const t = (item.type || "").toLowerCase();
        if (t === "domaincard" && "inVault" in (changed.system || {})) {
            pokerHandGlobalState.renderHand("config");
        }
        createStatusHUD(item.actor);
        recenterHUDColumns();
        ensureDeckFaceDownIfCollapsed();
    });
    addHook("createItem", (item) => { if (item.actor?.id === actor.id) { createStatusHUD(item.actor); recenterHUDColumns(); pokerHandGlobalState.renderHand(pokerHandGlobalState.currentHandType); ensureDeckFaceDownIfCollapsed(); } });
    addHook("deleteItem", (item) => { if (item.actor?.id === actor.id) { createStatusHUD(item.actor); recenterHUDColumns(); pokerHandGlobalState.renderHand(pokerHandGlobalState.currentHandType); ensureDeckFaceDownIfCollapsed(); } });

    pokerHandGlobalState.hooks = hookRecords;

    const equippedDomainCards = actor.items.filter(i => (i.type || "").toLowerCase() === "domaincard" && !i.system.inVault).length;
    pokerHandGlobalState.persistedState.confirmed = persistedState.confirmed && (equippedDomainCards === persistedState.selectedItems.length);
    pokerHandGlobalState.saveState();


    pokerHandGlobalState.renderHand("config");
    applyGlobalCollapse();
    ensureDeckFaceDownIfCollapsed();
}

/* —— Cleanup (keeps bookmark toggle) —— */
pokerHandGlobalState.cleanup = () => {
document.getElementById("poker-hand-container")?.remove();
document.getElementById("status-hud-container")?.remove();
document.querySelector(".poker-card-tooltip")?.remove();
document.getElementById("poker-hand-styles")?.remove();
if (pokerHandGlobalState.sparkleInterval) { clearInterval(pokerHandGlobalState.sparkleInterval); pokerHandGlobalState.sparkleInterval = null; }
if (pokerHandGlobalState._sparkleHandlers?.container) {
const { container, enter, leave } = pokerHandGlobalState._sparkleHandlers;
container.removeEventListener("mouseenter", enter);
container.removeEventListener("mouseleave", leave);
pokerHandGlobalState._sparkleHandlers = null;
}
if (pokerHandGlobalState.hooks) {
pokerHandGlobalState.hooks.forEach(({event,id}) => Hooks.off(event, id));
pokerHandGlobalState.hooks = null;
}
};

window.pokerHandGlobalState = pokerHandGlobalState;