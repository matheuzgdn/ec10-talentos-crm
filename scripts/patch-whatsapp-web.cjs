const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "../node_modules/whatsapp-web.js/src");
const utilsTarget = path.join(packageRoot, "util/Injected/Utils.js");
const clientTarget = path.join(packageRoot, "Client.js");

if (!fs.existsSync(utilsTarget) || !fs.existsSync(clientTarget)) process.exit(0);

function readNormalized(file) {
  const original = fs.readFileSync(file, "utf8");
  return {
    source: original.replace(/\r\n/g, "\n"),
    newline: original.includes("\r\n") ? "\r\n" : "\n",
  };
}

function writeNormalized(file, source, newline) {
  fs.writeFileSync(file, source.replace(/\n/g, newline));
}

const oldMsgKeyCode = `        return window
            .require('WAWebCollections')
            .Msg.get(newMsgKey._serialized);`;
const newMsgKeyCode = `        const serializedNewMsgKey =
            newMsgKey._serialized || newMsgKey.$1 || newMsgKey.toString();
        return window
            .require('WAWebCollections')
            .Msg.get(serializedNewMsgKey);`;

const mediaPrivateIdFix = `        // EC10 WhatsApp Web 2.3000.1047775310 media compatibility.
        // MediaData currently exposes an enumerable private id that overrides
        // the valid MsgKey when mediaOptions is spread into the message.
        delete message.__x_id;`;

const newOpeningWait = `            if (
                state === 'OPENING' ||
                state === 'UNLAUNCHED' ||
                state === 'PAIRING'
            ) {
                // Recent WhatsApp Web builds can miss the change:state event.
                // Polling also catches a transition that happens before the
                // listener is attached, avoiding an infinite initialization.
                await new Promise((resolve) => {
                    const pendingStates = new Set([
                        'OPENING',
                        'UNLAUNCHED',
                        'PAIRING',
                    ]);
                    const startedAt = Date.now();
                    const timer = setInterval(() => {
                        const nextState = window.require(
                            'WAWebSocketModel',
                        ).Socket.state;
                        if (
                            !pendingStates.has(nextState) ||
                            Date.now() - startedAt >= 60000
                        ) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 250);
                });
            }`;

let changed = false;

{
  const file = readNormalized(utilsTarget);
  let utilsSource = file.source;
  if (!utilsSource.includes(newMsgKeyCode)) {
    if (!utilsSource.includes(oldMsgKeyCode)) {
      throw new Error("whatsapp-web.js sendMessage patch target was not found");
    }
    utilsSource = utilsSource.replace(oldMsgKeyCode, newMsgKeyCode);
    changed = true;
  }
  if (!utilsSource.includes(mediaPrivateIdFix)) {
    const mediaPrivateIdAnchor = `        };

        // Bot's won't reply if canonicalUrl is set (linking)`;
    if (!utilsSource.includes(mediaPrivateIdAnchor)) {
      throw new Error("whatsapp-web.js media private id patch target was not found");
    }
    utilsSource = utilsSource.replace(
      mediaPrivateIdAnchor,
      `        };

${mediaPrivateIdFix}

        // Bot's won't reply if canonicalUrl is set (linking)`,
    );
    changed = true;
  }
  if (utilsSource !== file.source) writeNormalized(utilsTarget, utilsSource, file.newline);
}

{
  const file = readNormalized(clientTarget);
  if (!file.source.includes(newOpeningWait)) {
    const openingStart = file.source.indexOf(
      "            if (\n                state === 'OPENING' ||",
    );
    const openingEndMarker =
      "\n            state = window.require('WAWebSocketModel').Socket.state;";
    const openingEnd = file.source.indexOf(openingEndMarker, openingStart);
    if (openingStart < 0 || openingEnd < 0) {
      throw new Error("whatsapp-web.js opening-state patch target was not found");
    }
    writeNormalized(
      clientTarget,
      file.source.slice(0, openingStart) +
        newOpeningWait +
        file.source.slice(openingEnd),
      file.newline,
    );
    changed = true;
  }

  let clientSource = readNormalized(clientTarget).source;
  // Preserve WhatsApp's own vote persistence even if our event decoding fails.
  const pollHookMarker = "/* EC10 resilient poll vote hook */";
  if (!clientSource.includes(pollHookMarker)) {
    const start = clientSource.indexOf("            window.WWebJS.injectToFunction(\n                {\n                    module: 'WAWebAddonPollVoteTableMode',");
    const end = clientSource.indexOf("\n            );", start) + "\n            );".length;
    if (start < 0 || end <= start) throw new Error('WhatsApp poll hook patch target was not found');
    const resilientHook = `            /* EC10 resilient poll vote hook */
            window.WWebJS.injectToFunction(
                { module: 'WAWebAddonPollVoteTableMode', function: 'pollVoteTableMode.bulkUpsert' },
                async (module, origFunction, ...args) => {
                    const result = await origFunction.apply(module, args);
                    try {
                        const serialize = key => typeof key === 'string' ? key : key?._serialized || key?.$1 || (key?.user && key?.server ? key.user + '@' + key.server : '');
                        const votes = await Promise.all((args[0] || []).map(async vote => {
                            const parentId = serialize(vote.parentMsgKey || vote.pollUpdateParentKey);
                            let parentMessage = parentId ? Msg.get(parentId) : null;
                            if (!parentMessage && parentId) {
                                const fetched = await Msg.getMessagesById([parentId]);
                                parentMessage = fetched?.messages?.[0] || null;
                            }
                            return {
                                ...vote,
                                sender: serialize(vote.sender || vote.author || vote.from),
                                parentMsgKey: parentId,
                                selectedOptionLocalIds: Array.from(vote.selectedOptionLocalIds || []),
                                parentMessage: parentMessage ? window.WWebJS.getMessageModel(parentMessage) : null
                            };
                        }));
                        window.onPollVoteEvent(votes);
                    } catch (error) {
                        console.warn('EC10 poll event decoding deferred to recovery', String(error));
                    }
                    return result;
                },
            );`;
    clientSource = clientSource.slice(0,start) + resilientHook + clientSource.slice(end);
    changed = true;
  }
  const oldPollEmit = "                    this.emit(Events.VOTE_UPDATE, new PollVote(this, vote));";
  const newPollEmit = "                    try { this.emit(Events.VOTE_UPDATE, new PollVote(this, vote)); }\n                    catch (_) { this.emit(Events.VOTE_UPDATE, vote); }";
  if (!clientSource.includes(newPollEmit)) {
    if (!clientSource.includes(oldPollEmit)) throw new Error('WhatsApp poll emit patch target was not found');
    clientSource = clientSource.replace(oldPollEmit,newPollEmit);
    changed = true;
  }
  const syncedDeclaration = "        let appStateSynced = false;\n";
  const syncedExposeMarker = `        await exposeFunctionIfAbsent(
            this.pupPage,
            'onAppStateHasSyncedEvent',`;
  if (!clientSource.includes(syncedDeclaration)) {
    if (!clientSource.includes(syncedExposeMarker)) {
      throw new Error("whatsapp-web.js synced callback target was not found");
    }
    clientSource = clientSource.replace(
      syncedExposeMarker,
      syncedDeclaration + syncedExposeMarker,
    );
    changed = true;
  }

  const syncedCallbackStart = `            async () => {
                const authEventPayload =`;
  const guardedSyncedCallbackStart = `            async () => {
                if (appStateSynced) return;
                appStateSynced = true;
                const authEventPayload =`;
  if (!clientSource.includes(guardedSyncedCallbackStart)) {
    if (!clientSource.includes(syncedCallbackStart)) {
      throw new Error("whatsapp-web.js synced guard target was not found");
    }
    clientSource = clientSource.replace(
      syncedCallbackStart,
      guardedSyncedCallbackStart,
    );
    changed = true;
  }

  const oldStateListeners = `        await this.pupPage.evaluate(() => {
            window
                .require('WAWebSocketModel')
                .Socket.on('change:state', (_AppState, state) => {
                    window.onAuthAppStateChangedEvent(state);
                });
            window
                .require('WAWebSocketModel')
                .Socket.on('change:hasSynced', () => {
                    window.onAppStateHasSyncedEvent();
                });`;
  const newStateListeners = `        await this.pupPage.evaluate(async () => {
            const socket = window.require('WAWebSocketModel').Socket;
            socket.on('change:state', (_AppState, state) => {
                window.onAuthAppStateChangedEvent(state);
            });
            socket.on('change:hasSynced', () => {
                window.onAppStateHasSyncedEvent();
            });
            if (socket.hasSynced || socket.state === 'CONNECTED') {
                await window.onAppStateHasSyncedEvent();
            }`;
  if (!clientSource.includes(newStateListeners)) {
    if (!clientSource.includes(oldStateListeners)) {
      throw new Error("whatsapp-web.js state listener patch target was not found");
    }
    clientSource = clientSource.replace(oldStateListeners, newStateListeners);
    changed = true;
  }

  if (clientSource !== readNormalized(clientTarget).source) {
    writeNormalized(clientTarget, clientSource, file.newline);
  }
}

if (changed) console.log("Applied WhatsApp Web compatibility patches.");
