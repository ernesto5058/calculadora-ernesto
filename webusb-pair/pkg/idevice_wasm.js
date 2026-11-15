/* @ts-self-types="./idevice_wasm.d.ts" */

/**
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {boolean} verbose
 * @param {string} pair_record_plist_xml
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<string>}
 */
export function lockdownBattery(device, mode, host_id, system_buid, verbose, pair_record_plist_xml, tls_client_auth, tls_sni) {
    const val7 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownBattery(device, ptr0, len0, ptr1, len1, ptr2, len2, val7, ptr3, len3, ptr4, len4, ptr5, len5);
    return ret;
}

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → optional TLS → `GetValue battery`.
 * Pass **`pair_record_plist_xml`** to reuse an existing pair record; otherwise keys are generated based on `mode`.
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {boolean} verbose
 * @param {string} pair_record_plist_xml
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<string>}
 */
export function lockdownBatteryPickDevice(mode, host_id, system_buid, verbose, pair_record_plist_xml, tls_client_auth, tls_sni) {
    const val7 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownBatteryPickDevice(ptr0, len0, ptr1, len1, ptr2, len2, val7, ptr3, len3, ptr4, len4, ptr5, len5);
    return ret;
}

/**
 * `crashreportmover` + AFC crash report copy. Works with either a pre-existing pair-record plist or
 * with generated keys (pair mode `random` / `legacy`) — the latter runs a full `Pair` + Trust flow first.
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {string} pair_record_plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @param {boolean} keep
 * @param {string} filter_substr
 * @param {boolean} remove_all
 * @returns {Promise<any>}
 */
export function lockdownCrashReports(device, mode, host_id, system_buid, pair_record_plist_xml, verbose, tls_client_auth, tls_sni, keep, filter_substr, remove_all) {
    const val8 = +verbose;
    const val9 = +keep;
    const val10 = +remove_all;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
        ptr6 = passStringToWasm0(filter_substr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len6 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr6) { wasm.__wbindgen_free(ptr6, len6 * 1, 1); }
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownCrashReports(device, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val8, ptr4, len4, ptr5, len5, val9, ptr6, len6, val10);
    return ret;
}

/**
 * @returns {string}
 */
export function lockdownCrashReportsInfo() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.lockdownCrashReportsInfo();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {boolean} verbose
 * @param {string} pair_record_plist_xml
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<string>}
 */
export function lockdownDiagnostics(device, mode, host_id, system_buid, verbose, pair_record_plist_xml, tls_client_auth, tls_sni) {
    const val7 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownDiagnostics(device, ptr0, len0, ptr1, len1, ptr2, len2, val7, ptr3, len3, ptr4, len4, ptr5, len5);
    return ret;
}

/**
 * Same as battery, then the diagnostic `GetValue` batch.
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {boolean} verbose
 * @param {string} pair_record_plist_xml
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<string>}
 */
export function lockdownDiagnosticsPickDevice(mode, host_id, system_buid, verbose, pair_record_plist_xml, tls_client_auth, tls_sni) {
    const val7 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownDiagnosticsPickDevice(ptr0, len0, ptr1, len1, ptr2, len2, val7, ptr3, len3, ptr4, len4, ptr5, len5);
    return ret;
}

/**
 * **`QueryType`** → **`StartSession`** → **`GetValue`** batch (cleartext or TLS). Requires a **full** XML pair-record plist
 * (HostID, SystemBUID, and PEM keys). **`tls_client_auth`**: `host` | `root` | `chain`. **`tls_sni`**: `device` | `none`.
 * @param {USBDevice} device
 * @param {string} plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<string>}
 */
export function lockdownFetchWithPlistXml(device, plist_xml, verbose, tls_client_auth, tls_sni) {
    const val4 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2;
    try {
        ptr0 = passStringToWasm0(plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownFetchWithPlistXml(device, ptr0, len0, val4, ptr1, len1, ptr2, len2);
    return ret;
}

/**
 * Pair with **freshly generated** RSA keys (random / legacy ids), wait for Trust on the device,
 * and return the resulting pair-record **XML plist** (HostID / SystemBUID / PEM keys) so the page
 * can save it for subsequent `StartSession` + TLS without re-prompting the user.
 * @param {USBDevice} device
 * @param {string} mode
 * @param {boolean} verbose
 * @returns {Promise<string>}
 */
export function lockdownPair(device, mode, verbose) {
    const val2 = +verbose;
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.lockdownPair(device, ptr0, len0, val2);
    return ret;
}

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → TLS upgrade →
 * `StartService(com.apple.pcapd)` → secondary mux TCP + TLS → libpcap stream.
 *
 * **Stops** when:
 * - `on_packet` returns `false` → `stoppedReason = "user-stop"`
 * - `packets >= max_packets` (when `max_packets > 0`) → `"max-packets"`
 * - `pcap_bytes >= max_bytes` (when `max_bytes > 0`) → `"max-bytes"`
 * - `max_duration_ms` elapsed → `"max-duration"`
 * - the device closes the relay (cleartext path only) → `"stream-closed"`
 *
 * `data` in the resulting object is a **complete libpcap file** (`LINKTYPE_ETHERNET`, snaplen
 * 65535). The page can blob+download it directly into Wireshark / `tcpdump -r`.
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {string} pair_record_plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @param {Function} on_packet
 * @param {string} process_filter
 * @param {string} interface_filter
 * @param {number} max_packets
 * @param {number} max_bytes
 * @param {number} max_duration_ms
 * @returns {Promise<any>}
 */
export function lockdownPcap(device, mode, host_id, system_buid, pair_record_plist_xml, verbose, tls_client_auth, tls_sni, on_packet, process_filter, interface_filter, max_packets, max_bytes, max_duration_ms) {
    const val9 = +verbose;
    const val10 = +max_packets;
    const val11 = +max_bytes;
    const val12 = +max_duration_ms;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
        ptr6 = passStringToWasm0(process_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len6 = WASM_VECTOR_LEN;
        ptr7 = passStringToWasm0(interface_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len7 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr7) { wasm.__wbindgen_free(ptr7, len7 * 1, 1); }
        if (ptr6) { wasm.__wbindgen_free(ptr6, len6 * 1, 1); }
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownPcap(device, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val9, ptr4, len4, ptr5, len5, on_packet, ptr6, len6, ptr7, len7, val10, val11, val12);
    return ret;
}

/**
 * @param {USBDevice} device
 * @param {boolean} verbose
 * @returns {Promise<string>}
 */
export function lockdownQueryType(device, verbose) {
    const ret = wasm.lockdownQueryType(device, verbose);
    return ret;
}

/**
 * `QueryType` on lockdownd (cleartext). **`verbose`**: log mux/TCP details to the browser console.
 * @param {boolean} verbose
 * @returns {Promise<string>}
 */
export function lockdownQueryTypePickDevice(verbose) {
    const ret = wasm.lockdownQueryTypePickDevice(verbose);
    return ret;
}

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → TLS upgrade →
 * `StartService(com.apple.mobile.screenshotr)` → secondary TLS → DeviceLink handshake →
 * `ScreenShotRequest` → `ScreenShotReply.ScreenShotData`.
 *
 * Returns `{ data: Uint8Array, extension: "png" | "tiff" | "dat", mime, byteLength }`. The
 * caller decides whether to render it (`<img src="data:image/...">`), download it, or both.
 *
 * **Requires a mounted Developer Disk Image**; otherwise lockdownd answers `InvalidService`
 * and we surface a friendly error.
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {string} pair_record_plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<any>}
 */
export function lockdownScreenshot(device, mode, host_id, system_buid, pair_record_plist_xml, verbose, tls_client_auth, tls_sni) {
    const val7 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownScreenshot(device, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val7, ptr4, len4, ptr5, len5);
    return ret;
}

/**
 * Download one sysdiagnose `.tar.gz` by device AFC path (up to ~512 MiB).
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {string} pair_record_plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @param {string} device_path
 * @param {Function | null} [on_progress]
 * @returns {Promise<any>}
 */
export function lockdownSysdiagnoseDownload(device, mode, host_id, system_buid, pair_record_plist_xml, verbose, tls_client_auth, tls_sni, device_path, on_progress) {
    const val8 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
        ptr6 = passStringToWasm0(device_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len6 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr6) { wasm.__wbindgen_free(ptr6, len6 * 1, 1); }
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownSysdiagnoseDownload(device, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val8, ptr4, len4, ptr5, len5, ptr6, len6, isLikeNone(on_progress) ? 0 : addToExternrefTable0(on_progress));
    return ret;
}

/**
 * @returns {string}
 */
export function lockdownSysdiagnoseInfo() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.lockdownSysdiagnoseInfo();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * List sysdiagnose `.tar.gz` archives on the device (metadata only; no download).
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {string} pair_record_plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @returns {Promise<any>}
 */
export function lockdownSysdiagnoseList(device, mode, host_id, system_buid, pair_record_plist_xml, verbose, tls_client_auth, tls_sni) {
    const val7 = +verbose;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownSysdiagnoseList(device, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val7, ptr4, len4, ptr5, len5);
    return ret;
}

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → TLS upgrade →
 * `StartService(com.apple.syslog_relay)` → secondary mux TCP + (TLS or cleartext) → stream
 * decoded chunks to `on_chunk(text, totalBytes)`.
 *
 * **Stops** when:
 * - `on_chunk` returns `false` → `stoppedReason = "user-stop"`
 * - `accumulated.len() >= max_bytes` (when `max_bytes > 0`) → `"max-bytes"`
 * - `max_duration_ms` elapsed → `"max-duration"`
 * - the device closes the relay (cleartext path only) → `"stream-closed"`
 *
 * Returns `{ bytes, durationMs, stoppedReason, ssl, data: Uint8Array }`. The full byte capture
 * is in `data` so the page can offer **Save** without re-decoding strings.
 * @param {USBDevice} device
 * @param {string} mode
 * @param {string} host_id
 * @param {string} system_buid
 * @param {string} pair_record_plist_xml
 * @param {boolean} verbose
 * @param {string} tls_client_auth
 * @param {string} tls_sni
 * @param {Function} on_chunk
 * @param {number} max_bytes
 * @param {number} max_duration_ms
 * @returns {Promise<any>}
 */
export function lockdownSyslog(device, mode, host_id, system_buid, pair_record_plist_xml, verbose, tls_client_auth, tls_sni, on_chunk, max_bytes, max_duration_ms) {
    const val7 = +verbose;
    const val8 = +max_bytes;
    const val9 = +max_duration_ms;
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
    try {
        ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(host_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(system_buid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passStringToWasm0(pair_record_plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
        ptr4 = passStringToWasm0(tls_client_auth, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len4 = WASM_VECTOR_LEN;
        ptr5 = passStringToWasm0(tls_sni, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len5 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
        if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.lockdownSyslog(device, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val7, ptr4, len4, ptr5, len5, on_chunk, val8, val9);
    return ret;
}

/**
 * After **`requestAppleDevice()`**, run mux + TCP handshake to **lockdownd**.
 * @param {USBDevice} device
 * @param {boolean} verbose
 * @returns {Promise<string>}
 */
export function muxLockdownHandshake(device, verbose) {
    const ret = wasm.muxLockdownHandshake(device, verbose);
    return ret;
}

/**
 * Request an Apple USB device (picker) and complete mux **VERSION** (+ **SETUP**) + TCP handshake to **lockdownd**.
 * **`verbose`**: log mux/TCP framing to the browser **`console`** (same spirit as `--lockdown-tls-debug` on the host).
 * @param {boolean} verbose
 * @returns {Promise<string>}
 */
export function muxLockdownHandshakePickDevice(verbose) {
    const ret = wasm.muxLockdownHandshakePickDevice(verbose);
    return ret;
}

/**
 * Parse **`HostID`** / **`SystemBUID`** from XML pair-record plist bytes (libimobiledevice-style keys).
 * Returns a JS object `{ hostId, systemBuid }` for use with **`lockdownFetchWithPlistXml`** or manual fields.
 * @param {string} plist_xml
 * @returns {any}
 */
export function pairingIdsFromPlistXml(plist_xml) {
    const ptr0 = passStringToWasm0(plist_xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pairingIdsFromPlistXml(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Start generating RSA host keys in the background (call right after `requestAppleDevice`).
 * `lockdownPair` consumes the cache so the Trust prompt is not delayed by key generation.
 */
export function prefetchPairHostKeys() {
    wasm.prefetchPairHostKeys();
}

/**
 * `navigator.usb.requestDevice` with Apple **VID 0x05ac** (must run from a user gesture).
 *
 * Fails with a human-friendly diagnostic when `navigator.usb` isn't accessible — the WebUSB
 * API is only exposed in a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)
 * (HTTPS or `localhost`/`127.0.0.1`) on Chromium-based browsers, so users hitting this from
 * `file://` or Firefox/Safari otherwise saw an opaque `Cannot read properties of undefined`
 * crash deep in the wasm-bindgen runtime.
 * @returns {Promise<USBDevice>}
 */
export function requestAppleDevice() {
    const ret = wasm.requestAppleDevice();
    return ret;
}

/**
 * One-time panic hook → `console.error` (helps debug WASM panics in DevTools).
 */
export function wasm_start_hook() {
    wasm.wasm_start_hook();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_boolean_get_4f1baf9a00be3c74: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_f249a2a76caa9a55: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_c22311b1cc228e3a: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_09736879a3f67559: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_alternateSetting_17a6cd690c514908: function(arg0) {
            const ret = arg0.alternateSetting;
            return ret;
        },
        __wbg_alternates_f55bc56074ab018b: function(arg0) {
            const ret = arg0.alternates;
            return ret;
        },
        __wbg_buffer_297cd789e9811340: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_byteLength_3e08292247d5e8da: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_byteOffset_860d904683273dd7: function(arg0) {
            const ret = arg0.byteOffset;
            return ret;
        },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_fc92fee6137d452d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_claimInterface_08a5ab645b31305c: function(arg0, arg1) {
            const ret = arg0.claimInterface(arg1);
            return ret;
        },
        __wbg_clearHalt_a7f0136c87ca4779: function(arg0, arg1, arg2) {
            const ret = arg0.clearHalt(__wbindgen_enum_UsbDirection[arg1], arg2);
            return ret;
        },
        __wbg_clearTimeout_113b1cde814ec762: function(arg0) {
            const ret = clearTimeout(arg0);
            return ret;
        },
        __wbg_configurationValue_5e55eb512d0b4709: function(arg0) {
            const ret = arg0.configurationValue;
            return ret;
        },
        __wbg_configuration_f99a2203492f4340: function(arg0) {
            const ret = arg0.configuration;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_configurations_24b1225aa35885bd: function(arg0) {
            const ret = arg0.configurations;
            return ret;
        },
        __wbg_crypto_23f565a907d30078: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_data_c68221e8cb9b34ec: function(arg0) {
            const ret = arg0.data;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_debug_29e5044b8c3730bb: function(arg0) {
            console.debug(arg0);
        },
        __wbg_direction_ba45455c20732500: function(arg0) {
            const ret = arg0.direction;
            return (__wbindgen_enum_UsbDirection.indexOf(ret) + 1 || 3) - 1;
        },
        __wbg_endpointNumber_170a3f71ea5d0dcd: function(arg0) {
            const ret = arg0.endpointNumber;
            return ret;
        },
        __wbg_endpoints_c458717fe1e187c4: function(arg0) {
            const ret = arg0.endpoints;
            return ret;
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_getRandomValues_d2908e0b99612b91: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_getTime_edc91481cbc4cd78: function(arg0) {
            const ret = arg0.getTime();
            return ret;
        },
        __wbg_get_2080c49015e35254: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_d7176cfb76d71114: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_instanceof_UsbAlternateInterface_c00a703ade7e5096: function(arg0) {
            let result;
            try {
                result = arg0 instanceof USBAlternateInterface;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_UsbConfiguration_0a9594447856d314: function(arg0) {
            let result;
            try {
                result = arg0 instanceof USBConfiguration;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_UsbDevice_0f260d27f49462f8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof USBDevice;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_UsbEndpoint_2c55d42fafb99454: function(arg0) {
            let result;
            try {
                result = arg0 instanceof USBEndpoint;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_UsbInTransferResult_10917aa8b147dbff: function(arg0) {
            let result;
            try {
                result = arg0 instanceof USBInTransferResult;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_UsbInterface_180edc5fd962b377: function(arg0) {
            let result;
            try {
                result = arg0 instanceof USBInterface;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Window_5cf453f5639aa1a2: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_interfaceClass_e9f7a6ab7d24b4ea: function(arg0) {
            const ret = arg0.interfaceClass;
            return ret;
        },
        __wbg_interfaceNumber_241dbd2183d8da71: function(arg0) {
            const ret = arg0.interfaceNumber;
            return ret;
        },
        __wbg_interfaceSubclass_1483a0f59e18ea42: function(arg0) {
            const ret = arg0.interfaceSubclass;
            return ret;
        },
        __wbg_interfaces_1599402754d38b7f: function(arg0) {
            const ret = arg0.interfaces;
            return ret;
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_b03a0fabb109b1e9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_log_ff86bbb34c295e21: function(arg0) {
            console.log(arg0);
        },
        __wbg_msCrypto_d5f06fad6bf1409b: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_navigator_c17f443a6fe5d38d: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_0_36d738a0c8cfac43: function() {
            const ret = new Date();
            return ret;
        },
        __wbg_new_37eb45aaf5eeb820: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_bb74001155cb8ca8: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_cd4348290afae586: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_typed_e09da9dae6ee5935: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___js_sys_3ee90d5f5d6cc144___Function_fn_wasm_bindgen_84df2d7dc6f28eed___JsValue_____wasm_bindgen_84df2d7dc6f28eed___sys__Undefined___js_sys_3ee90d5f5d6cc144___Function_fn_wasm_bindgen_84df2d7dc6f28eed___JsValue_____wasm_bindgen_84df2d7dc6f28eed___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_byte_offset_and_length_3cd32055a417f095: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_86166ff8ce1f2002: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_463ac581d2fc7ea3: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_open_796a23d7e65fdeab: function(arg0) {
            const ret = arg0.open();
            return ret;
        },
        __wbg_opened_75ebc6119a161d56: function(arg0) {
            const ret = arg0.opened;
            return ret;
        },
        __wbg_process_91f425a63f58e399: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_c9f4893fc209f768: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_1e8503a8a690f0a3: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_4a1a4d8dd332373b: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomFillSync_34b023059e3363de: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_releaseInterface_0cd4007b3d31f3ec: function(arg0, arg1) {
            const ret = arg0.releaseInterface(arg1);
            return ret;
        },
        __wbg_requestDevice_b32d5fb341bc0304: function(arg0, arg1) {
            const ret = arg0.requestDevice(arg1);
            return ret;
        },
        __wbg_require_9a7d8cc2e1d275c0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_reset_9e4f410a20836d44: function(arg0) {
            const ret = arg0.reset();
            return ret;
        },
        __wbg_resolve_dbf78ab4942478b0: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_selectAlternateInterface_18d7a84ab202c616: function(arg0, arg1, arg2) {
            const ret = arg0.selectAlternateInterface(arg1, arg2);
            return ret;
        },
        __wbg_selectConfiguration_4acc1da30dcf525d: function(arg0, arg1) {
            const ret = arg0.selectConfiguration(arg1);
            return ret;
        },
        __wbg_setTimeout_a60d83bec06b4345: function() { return handleError(function (arg0, arg1) {
            const ret = setTimeout(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_set_2793479888329cb6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_feb3714f475485ba: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_set_filters_314e4e5b45810c8d: function(arg0, arg1, arg2) {
            arg0.filters = getArrayJsValueViewFromWasm0(arg1, arg2);
        },
        __wbg_set_vendor_id_e714eebaf5b87439: function(arg0, arg1) {
            arg0.vendorId = arg1;
        },
        __wbg_stack_575c4e0918581b9c: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_58f388a9247ac0bb: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_then_656f253a5dd7d8ea: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_e3f7f2d365708be8: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_transferIn_99690548102d2a9c: function(arg0, arg1, arg2) {
            const ret = arg0.transferIn(arg1, arg2 >>> 0);
            return ret;
        },
        __wbg_transferOut_7a1e17d70de914a5: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.transferOut(arg1, getArrayU8FromWasm0(arg2, arg3));
            return ret;
        }, arguments); },
        __wbg_type_c0f3054a42ba73d6: function(arg0) {
            const ret = arg0.type;
            return (__wbindgen_enum_UsbEndpointType.indexOf(ret) + 1 || 4) - 1;
        },
        __wbg_usb_9abb50f5953f5437: function(arg0) {
            const ret = arg0.usb;
            return ret;
        },
        __wbg_versions_6e128a981b0df859: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbg_warn_228ff2257384d295: function(arg0) {
            console.warn(arg0);
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 1091, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("USBDevice")], shim_idx: 320, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("USBInTransferResult")], shim_idx: 320, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__25);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("USBOutTransferResult")], shim_idx: 320, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__26);
            return ret;
        },
        __wbindgen_generic_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("undefined")], shim_idx: 320, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__27);
            return ret;
        },
        __wbindgen_generic_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 1059, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke_______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000007: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000008: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000009: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./idevice_wasm_bg.js": import0,
    };
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke_______true_(arg0, arg1) {
    wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke_______true_(arg0, arg1);
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__25(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__25(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__26(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__26(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__27(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___wasm_bindgen_84df2d7dc6f28eed___sys__Undefined__core_d941ad8722425d2e___result__Result_____wasm_bindgen_84df2d7dc6f28eed___JsError___true__27(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___js_sys_3ee90d5f5d6cc144___Function_fn_wasm_bindgen_84df2d7dc6f28eed___JsValue_____wasm_bindgen_84df2d7dc6f28eed___sys__Undefined___js_sys_3ee90d5f5d6cc144___Function_fn_wasm_bindgen_84df2d7dc6f28eed___JsValue_____wasm_bindgen_84df2d7dc6f28eed___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_84df2d7dc6f28eed___convert__closures_____invoke___js_sys_3ee90d5f5d6cc144___Function_fn_wasm_bindgen_84df2d7dc6f28eed___JsValue_____wasm_bindgen_84df2d7dc6f28eed___sys__Undefined___js_sys_3ee90d5f5d6cc144___Function_fn_wasm_bindgen_84df2d7dc6f28eed___JsValue_____wasm_bindgen_84df2d7dc6f28eed___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_UsbDirection = ["in", "out"];


const __wbindgen_enum_UsbEndpointType = ["bulk", "interrupt", "isochronous"];

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    switch (typeof val) {
        // primitive types
        case 'number':
        case 'boolean':
        case 'undefined':
        return `${val}`;
        case 'string':
        return JSON.stringify(val);
        case 'bigint':
        return `${val}n`;
        case 'symbol':
        return val.description !== undefined
            ? `Symbol(${val.description})`
            : 'Symbol';
        case 'function':
        return typeof val.name === 'string' && val.name !== ''
            ? `Function(${val.name})`
            : 'Function';
        case 'object': {
            if (val === null) {
                return 'null';
            }
            // objects
            if (Array.isArray(val)) {
                return '[' + Array.from(val, debugString).join(', ') + ']';
            }
            // errors
            if (val instanceof Error) {
                return `${val.name}: ${val.message}\n${val.stack}`;
            }

            const toStringOutput = toString.call(val);
            // Test for built-in
            const className = /\[object ([^\]]+)\]/.exec(toStringOutput)?.[1];

            // Failed to match the standard '[object ClassName]'
            if (className === undefined) {
                return toStringOutput;
            }
            if (className === 'Object') {
                // we're a user defined class or Object
                // JSON.stringify avoids problems with cycles, and is generally much
                // easier than looping through ownProperties of `val`.
                try {
                    return 'Object(' + JSON.stringify(val) + ')';
                } catch (_) {
                    return 'Object';
                }
            }
            // TODO we could test for more things here, like `Set`s and `Map`s.
            return className;
        }
        // Per MDN: 'This list of values is exhaustive.'
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#description
    }
}

function getArrayJsValueViewFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('idevice_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
