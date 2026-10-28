'use strict';
'require daeuniverse.service as service';
'require fs';
'require ui';

/* Configuration wizard
 *
 * A form that generates the whole entry configuration file and writes it back
 * through the same path as the raw editor. Fields are prefilled from the
 * current file where a simple block parse suffices; the raw editor tab stays
 * authoritative for anything the wizard does not cover.
 */

/* The inner text of `name { ... }` at the top level of text; '' when absent.
   Depth is tracked so that e.g. dns.routing does not win over the real
   routing section when both appear. */
function block(text, name) {
	let depth = 0, i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '{') { depth++; i++; continue; }
		if (c === '}') { depth--; i++; continue; }
		if (depth === 0 && /[A-Za-z_]/.test(c)) {
			const word = /^[A-Za-z_][\w-]*/.exec(text.slice(i))[0];
			if (word === name && /^\s*\{/.test(text.slice(i + word.length))) {
				let j = i + word.length + /^\s*/.exec(text.slice(i + word.length))[0].length + 1;
				const start = j;
				let d = 1;
				for (; j < text.length && d; j++) {
					if (text[j] === '{') d++;
					else if (text[j] === '}') d--;
				}
				return text.slice(start, j - 1);
			}
			i += word.length;
			continue;
		}
		i++;
	}
	return '';
}

/* First `key: value` in a block; quotes are stripped. */
function kv(blk, key) {
	const m = new RegExp('^\\s*' + key + '\\s*:\\s*(.+?)\\s*$', 'm').exec(blk);
	if (!m)
		return null;
	return m[1].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$2');
}

function isTrue(v) {
	return v === 'true' || v === 'yes' || v === 'on' || v === '1';
}

/* Quote a value when it is not a bare scalar. */
function q(v) {
	return /^[A-Za-z0-9_.~@%+\-]+$/.test(v) ? v : "'" + v.replace(/'/g, "'\\''") + "'";
}

/* Form rows in the cbi style. */

const TITLE_TOP = 'align-self:start; padding-top:0';
const ROW_TOP = 'align-items:flex-start';
const FIELD_TOP = 'min-height:0';

function row(title, input, descr) {
	return E('div', { 'class': 'cbi-value', 'style': ROW_TOP }, [
		E('label', { 'class': 'cbi-value-title', 'style': TITLE_TOP }, title),
		E('div', { 'class': 'cbi-value-field', 'style': FIELD_TOP }, [ input,
			descr ? E('div', { 'class': 'cbi-value-description' }, descr) : null ])
	]);
}

function section(title, descr, rows) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		descr ? E('div', { 'class': 'cbi-section-descr' }, descr) : null,
		...rows
	]);
}

function input(value, type, opts) {
	const el = E('input', { 'class': 'cbi-input-' + (type ?? 'text'), 'type': type ?? 'text', 'value': value ?? '' });
	if (!type || type === 'text')
		el.style.width = '100%';
	if (opts?.placeholder)
		el.placeholder = opts.placeholder;
	return el;
}

function checkbox(checked) {
	return E('input', { 'type': 'checkbox', 'checked': checked ? 'checked' : null, 'style': 'margin:0' });
}

function select(value, choices) {
	return E('select', { 'class': 'cbi-input-select' },
		choices.map(c => E('option', { 'value': c, 'selected': c === value ? 'selected' : null }, c)));
}

/* Checkbox + monospace detail text side by side in the wide field column;
   putting long URLs/rules in the title column wraps badly. */
function checkRow(title, box, detail, note) {
	return E('div', { 'class': 'cbi-value', 'style': ROW_TOP }, [
		E('label', { 'class': 'cbi-value-title', 'style': TITLE_TOP }, title),
		E('div', { 'class': 'cbi-value-field', 'style': FIELD_TOP + '; display:flex; align-items:center; gap:.5em; flex-wrap:wrap' }, [
			box,
			detail ? E('code', { 'style': 'word-break:break-all' }, detail) : null,
			note ? E('span', { 'class': 'cbi-value-description', 'style': 'display:inline' }, note) : null
		])
	]);
}

function textarea(text) {
	return E('textarea', {
		'class': 'cbi-input-textarea', 'rows': 3, 'wrap': 'off', 'spellcheck': 'false',
		'style': 'width:100%; font-family:monospace'
	}, text ?? '');
}

function val(el) {
	return el.type === 'checkbox' ? el.checked : el.value.trim();
}

/*
 * Lines of `tag: 'url'` (kept as typed) or bare URLs, which get generated
 * tags; honk ignores untagged node links.
 */
function taggedLines(text, prefix) {
	return (text ?? '').split('\n')
		.map(l => l.trim())
		.filter(l => l && !l.startsWith('#'))
		.map((l, i) => /^\S+\s*:\s*['"]/.test(l) ? '    ' + l : '    ' + prefix + (i + 1) + ': ' + q(l));
}

return service.View.extend({
	app: {
		name: 'honk',
		title: 'honk',
		// Both create dae0/daens and hook the same interfaces: only one may run.
		other: 'dae',
		defaultConfig: '/etc/honk/config.dae',
		// honk-core has no offline check; a broken file is reported in the log.
		validate: null,
		// procd forwards stdout as "honk-core[pid]:", the init script logs as "honk:".
		logIdent: /^honk(-core)?(\[\d+\])?: /,
		webui: { port: 9527, path: '/ui/' },
		extraPanes() {
			return [ this.buildWizard() ];
		}
	},

	buildWizard() {
		const file = (this.files ?? []).find(f => f.path === this.entry);
		const text = file?.editor?.textarea.value ?? file?.text ?? '';

		const g = block(text, 'global');
		const dnsB = block(text, 'dns');
		const rtB = block(text, 'routing');
		const expB = block(text, 'experimental');
		const clashB = block(expB, 'clash_api');
		const apiB = block(expB, 'native_api');
		const cacheB = block(expB, 'cache_file');
		const assetsB = block(text, 'assets');
		const grpB = block(text, 'group');
		// The first named group block supplies name/filter/policy.
		const gm = /(^|[\s}])([A-Za-z_][\w-]*)\s*\{/.exec(grpB);
		const gName = gm?.[2] ?? '';
		const gInner = gName ? block(grpB, gName) : '';
		// Everything after the first named group stays raw as extra groups.
		let gExtra = '';
		if (gm) {
			let d = 0, j = gm.index + gm[0].length - 1;
			for (; j < grpB.length; j++) {
				if (grpB[j] === '{') d++;
				else if (grpB[j] === '}' && !--d) break;
			}
			gExtra = (grpB.slice(0, gm.index) + grpB.slice(j + 1)).trim();
		}

		const w = this.w = {};

		/* Global */
		w.lan = input(kv(g, 'lan_interface') ?? 'br-lan');
		w.wan = input(kv(g, 'wan_interface') ?? 'auto');
		w.logLevel = select(kv(g, 'log_level') ?? 'info', [ 'error', 'warn', 'info', 'debug', 'trace' ]);
		w.dialMode = select(kv(g, 'dial_mode') ?? 'domain++', [ 'ip', 'domain', 'domain+', 'domain++' ]);
		w.tproxyPort = input(kv(g, 'tproxy_port') ?? '12345');
		w.sniffTimeout = input(kv(g, 'sniffing_timeout') ?? '100ms');
		w.allowInsecure = checkbox(isTrue(kv(g, 'allow_insecure')));
		w.autoKernel = checkbox(kv(g, 'auto_config_kernel_parameter') == null || isTrue(kv(g, 'auto_config_kernel_parameter')));
		w.nfqueue = checkbox(kv(g, 'nfqueue_enable') == null || isTrue(kv(g, 'nfqueue_enable')));
		w.mptcp = checkbox(isTrue(kv(g, 'mptcp')));
		w.checkInterval = input(kv(g, 'check_interval') ?? '300s');
		w.checkTolerance = input(kv(g, 'check_tolerance') ?? '50ms');
		w.tcpCheckUrl = input(kv(g, 'tcp_check_url') ?? 'https://www.gstatic.com/generate_204');
		w.tcpCheckMethod = select(kv(g, 'tcp_check_http_method') ?? 'HEAD', [ 'HEAD', 'GET' ]);
		w.udpCheckDns = input(kv(g, 'udp_check_dns') ?? '8.8.8.8:53');
		w.bootstrap = input(kv(g, 'bootstrap_resolver') ?? '1.1.1.1:53');
		w.dataDir = input(kv(g, 'data_dir') ?? '/var/lib/honk');
		w.logFile = input(kv(g, 'log_file') ?? '');
		w.storeSub = checkbox(kv(g, 'store_subscribe') == null || isTrue(kv(g, 'store_subscribe')));
		w.soMark = input(kv(g, 'so_mark_from_dae') ?? '');
		w.tlsImpl = select(kv(g, 'tls_implementation') ?? 'tls', [ 'tls', 'utls' ]);
		w.preconnect = input(kv(g, 'preconnect_node_count') ?? 'auto');
		w.udpWarm = input(kv(g, 'udp_warm_node_count') ?? '0');
		w.maxDials = input(kv(g, 'max_concurrent_dials') ?? '64');

		/* Nodes and subscriptions */
		w.nodes = textarea(block(text, 'node').trim());
		w.subs = textarea(block(text, 'subscription').trim());

		/* Group */
		w.groupName = input(gName || 'proxy');
		const polM = /^(\w+)(?:\((\d+)\))?/.exec(kv(gInner, 'policy') ?? 'min_moving_avg');
		w.groupPolicy = select(polM?.[1] ?? 'min_moving_avg',
			[ 'min_moving_avg', 'fixed', 'min_delay', 'random', 'roundrobin', 'select' ]);
		w.groupFixedIndex = input(polM?.[2] ?? '0');
		// No filter selects every node; subtag() matches subscription tags.
		w.groupFilter = input(kv(gInner, 'filter') ?? '');
		w.groupFinal = input(kv(gInner, 'final') ?? '');
		w.groupExtra = textarea(gExtra);

		/* DNS upstreams: preset checkboxes plus custom `name: url` lines */
		const upB = block(dnsB, 'upstream');
		this.dnsPresets = [
			{ id: 'local',     label: _('Local dnsmasq'), url: 'udp://127.0.0.1:53',                                        detour: '' },
			{ id: 'alidns',    label: _('AliDNS'),        url: 'https://223.5.5.5/dns-query?tls_server_name=dns.alidns.com', detour: '' },
			{ id: 'googledns', label: _('Google DNS'),    url: 'https://8.8.8.8/dns-query?tls_server_name=dns.google',       detour: 'group' }
		];
		const declared = new Set();
		for (const m of upB.matchAll(/^\s*([A-Za-z_][\w-]*)\s*:/gm))
			declared.add(m[1]);
		w.upCustom = textarea(upB.split('\n')
			.map(l => l.trim())
			.filter(l => l && !l.startsWith('#') && !this.dnsPresets.some(p => l.startsWith(p.id + ':')))
			.join('\n'));

		const reqB = block(block(dnsB, 'routing'), 'request');
		const resB = block(block(dnsB, 'routing'), 'response');
		const rulesOf = b => b.split('\n')
			.map(l => l.trim())
			.filter(l => l && !l.startsWith('#') && !/^fallback\s*:/.test(l))
			.join('\n');
		w.dnsReqRules = textarea(rulesOf(reqB));
		w.dnsResRules = textarea(rulesOf(resB));
		w.dnsReqFallback = input(kv(reqB, 'fallback') ?? 'local');
		w.dnsResFallback = input(kv(resB, 'fallback') ?? 'accept');

		/* DNS listener, hosts, cache and fixed TTL */
		w.dnsBind = input(kv(dnsB, 'bind') ?? '');
		const hosts = [ ...dnsB.matchAll(/^\s*use_host\s*:\s*(.+?)\s*$/gm) ].map(m => m[1]);
		w.dnsHosts = textarea(hosts.join('\n'));
		w.clientSubnet = input(kv(dnsB, 'client_subnet') ?? '');
		w.ipVersion = select(kv(dnsB, 'ipversion_prefer') ?? '0', [ '0', '4', '6' ]);
		w.optCache = checkbox(kv(dnsB, 'optimistic_cache') == null || isTrue(kv(dnsB, 'optimistic_cache')));
		w.optCacheTtl = input(kv(dnsB, 'optimistic_cache_ttl') ?? '600');
		w.optStaleTtl = input(kv(dnsB, 'optimistic_stale_reply_ttl') ?? '30');
		w.maxCache = input(kv(dnsB, 'max_cache_size') ?? '10000');
		w.fixedTtl = textarea(block(dnsB, 'fixed_domain_ttl').trim());

		/* Routing rules: presets plus custom lines */
		const rtLines = rtB.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^fallback\s*:/.test(l));
		this.rtPresets = [
			{ id: 'dns',   rule: 'pname(dnsmasq) && l4proto(udp) && dport(53) -> direct(must)', note: _('Router DNS bypass') },
			{ id: 'webui', rule: 'dport(9527) -> direct(must)',                                  note: _('Management UI bypass') },
			{ id: 'proxy', rule: 'pname(sing-box, mihomo) -> direct(must)',                      note: _('Local proxy tools bypass') },
			{ id: 'priv',  rule: 'dip(geoip: private) -> direct(must)',                          note: _('Private addresses direct') },
			{ id: 'cnsite',rule: 'domain(geosite: geolocation-cn) -> direct',                    note: _('China domains direct') },
			{ id: 'cnip',  rule: 'dip(geoip: cn) -> direct',                                     note: _('China IPs direct') }
		];
		const known = new Set(this.rtPresets.map(p => p.rule));
		// A looser earlier form still counts as enabled.
		const aliases = { dns: 'pname(dnsmasq) -> direct(must)' };
		w.rtCustom = textarea(rtLines.filter(l => !known.has(l) && !Object.values(aliases).includes(l)).join('\n'));
		w.rtFallback = select(kv(rtB, 'fallback') ?? 'direct',
			[ 'direct', 'block', ...(gName ? [ gName ] : [ 'proxy' ]) ]);

		/* Experimental APIs */
		w.clashCtl = input(kv(clashB, 'external_controller') ?? '127.0.0.1:9090');
		w.clashSecret = input(kv(clashB, 'secret') ?? '');
		w.clashUi = input(kv(clashB, 'external_ui') ?? '');
		w.clashMode = select(kv(clashB, 'default_mode') ?? 'Rule', [ 'Rule', 'Global', 'Direct' ]);
		w.apiEnabled = checkbox(kv(apiB, 'enabled') == null || isTrue(kv(apiB, 'enabled')));
		w.apiListen = input(kv(apiB, 'listen') ?? '0.0.0.0:9527');
		w.apiSecret = input(kv(apiB, 'secret') ?? '');
		w.apiPass = checkbox(kv(apiB, 'password_auth') == null || isTrue(kv(apiB, 'password_auth')));
		w.apiAnon = checkbox(isTrue(kv(apiB, 'allow_anonymous_loopback')));
		w.apiOrigins = input(kv(apiB, 'allow_origins') ?? '');
		w.apiHosts = input(kv(apiB, 'allowed_hosts') ?? '');
		w.apiFlows = checkbox(kv(apiB, 'record_flows') == null || isTrue(kv(apiB, 'record_flows')));
		w.apiTraffic = checkbox(kv(apiB, 'record_traffic') == null || isTrue(kv(apiB, 'record_traffic')));
		w.apiMemory = checkbox(kv(apiB, 'record_memory') == null || isTrue(kv(apiB, 'record_memory')));
		w.apiLogs = checkbox(kv(apiB, 'record_logs') == null || isTrue(kv(apiB, 'record_logs')));
		w.apiDnsLog = checkbox(kv(apiB, 'record_dns_log') == null || isTrue(kv(apiB, 'record_dns_log')));
		w.apiConfigWrite = checkbox(isTrue(kv(apiB, 'config_write')));
		w.cacheFile = checkbox(kv(cacheB, 'enabled') == null || isTrue(kv(cacheB, 'enabled')));
		w.cacheDns = checkbox(isTrue(kv(cacheB, 'store_dns')));

		/* Assets */
		const geoB = block(assetsB, 'geodata');
		const uiB = block(assetsB, 'ui');
		const subB = block(assetsB, 'subscription');
		w.assetsRoute = input(kv(assetsB, 'route') ?? '');
		w.geositeUrl = input(kv(geoB, 'geosite') ?? '');
		w.geoipUrl = input(kv(geoB, 'geoip') ?? '');
		w.geodataRoute = input(kv(geoB, 'route') ?? '');
		w.uiUrl = input(kv(uiB, 'url') ?? '');
		w.uiRoute = input(kv(uiB, 'route') ?? '');
		w.subUa = input(kv(subB, 'ua') ?? '');
		w.subInterval = input(kv(subB, 'interval') ?? '');
		w.subCache = checkbox(kv(subB, 'cache') == null || isTrue(kv(subB, 'cache')));

		const gen = ui.createHandlerFn(this, 'handleWizardSave');

		return E('div', { 'data-tab': 'wizard', 'data-tab-title': _('Configuration wizard') }, [
			E('div', { 'class': 'cbi-section-descr' },
				_('Fill in the fields and generate the complete configuration file. Anything the wizard does not cover stays editable on the Configuration tab.')),

			section(_('Global'), null, [
				row(_('WAN interface'), w.wan, _('Interface of the default route; "auto" follows it')),
				row(_('LAN interface'), w.lan, _('LAN device(s) to hook, comma separated')),
				row(_('Log level'), w.logLevel),
				row(_('Dial mode'), w.dialMode, _('How outbound connections resolve domains')),
				row(_('TPROXY port'), w.tproxyPort),
				row(_('Sniffing timeout'), w.sniffTimeout),
				row(_('Allow insecure'), w.allowInsecure, _('Skip TLS certificate verification upstream')),
				row(_('Auto kernel parameters'), w.autoKernel),
				row(_('NFQUEUE'), w.nfqueue, _('Hold ambiguous LAN UDP first packets')),
				row(_('MPTCP'), w.mptcp),
				row(_('Check interval'), w.checkInterval),
				row(_('Check tolerance'), w.checkTolerance),
				row(_('TCP check URL'), w.tcpCheckUrl),
				row(_('TCP check method'), w.tcpCheckMethod),
				row(_('UDP check DNS'), w.udpCheckDns),
				row(_('Bootstrap resolver'), w.bootstrap, _('Used before any DNS upstream is up')),
				row(_('Data directory'), w.dataDir, _('Runtime state root; restart required')),
				row(_('Log file'), w.logFile, _('Empty logs to syslog only; relative paths resolve under data_dir')),
				row(_('Store subscriptions'), w.storeSub, _('Persist last subscription bodies for boot recovery')),
				row(_('SO_MARK'), w.soMark, _('Socket mark for self-originated sockets; empty keeps 0x100')),
				row(_('TLS implementation'), w.tlsImpl, _('utls enables Chrome-oriented ClientHello mimicry')),
				row(_('Preconnect nodes'), w.preconnect, _("'auto' warms up to eight TCP nodes at boot; 0 disables")),
				row(_('UDP warm nodes'), w.udpWarm, _('Per-group reusable UDP leaves to prewarm; 0 disables')),
				row(_('Max concurrent dials'), w.maxDials, _('Cap on physical proxy connections per generation'))
			]),

			section(_('Nodes and subscriptions'),
				_('One per line. Bare share links get generated tags; keep "tag: \'url\'" lines as typed.'), [
				row(_('Nodes'), w.nodes, _('Share links: ss://, vmess://, vless://, trojan://, hysteria2://, socks5://, ...')),
				row(_('Subscriptions'), w.subs, _('Subscription URLs, one per line'))
			]),

			section(_('Outbound group'), null, [
				row(_('Name'), w.groupName),
				row(_('Policy'), w.groupPolicy, _('fixed uses the first node; the others pick by latency or order')),
				row(_('Fixed index'), w.groupFixedIndex, _('Member index used when policy is fixed')),
				row(_('Filter'), w.groupFilter, _('Empty selects all nodes; e.g. subtag(mysub), name(keyword: x)')),
				row(_('Fallback group'), w.groupFinal, _('Used when no node survives the health check')),
				row(_('Additional groups'), w.groupExtra, _('Extra "name { filter/policy/final }" blocks, kept verbatim'))
			]),

			section(_('DNS upstreams'), _('Presets plus custom "name: url" lines.'), [
				...this.dnsPresets.map(p => checkRow(p.label,
					w['up_' + p.id] = checkbox(declared.has(p.id)),
					p.url,
					p.detour === 'group' ? _('Answered through the outbound group') : null)),
				row(_('Custom upstreams'), w.upCustom, _("name: 'url' or name: 'url' -> detour")),
				row(_('Request rules'), w.dnsReqRules, _('qname/qtype/sip rules, one per line')),
				row(_('Request fallback'), w.dnsReqFallback, _('An upstream name, asis or reject')),
				row(_('Response rules'), w.dnsResRules, _('upstream()/ip()/qname() rules, one per line')),
				row(_('Response fallback'), w.dnsResFallback, _('accept, reject or an upstream name')),
				row(_('DNS listener'), w.dnsBind, _('Optional unauthenticated resolver address; firewall it! Empty disables')),
				row(_('Hosts sources'), w.dnsHosts, _('One per line: "true" for /etc/hosts or an OxiDNS rules file path')),
				row(_('Client subnet'), w.clientSubnet, _("EDNS subnet preset: IPv4, CIDR, 'auto' or 'auto(IPv4)'")),
				row(_('IP version prefer'), w.ipVersion, _('4/6 prefer a family with fallback; 0 keeps both')),
				row(_('Optimistic cache'), w.optCache, _('Read and write positive and negative cache')),
				row(_('Cache TTL'), w.optCacheTtl, _('Positive answers: fixed seconds; 0 keeps answer TTL')),
				row(_('Stale reply TTL'), w.optStaleTtl, _('Serve-stale TTL in seconds; 0 keeps wire TTL')),
				row(_('Max cache size'), w.maxCache, _('Entry cap, clamped to 100000')),
				row(_('Fixed domain TTL'), w.fixedTtl, _('"domain: seconds" lines; 0 disables caching that name'))
			]),

			section(_('Routing'), null, [
				...this.rtPresets.map(p => checkRow(p.note,
					w['rt_' + p.id] = checkbox(rtLines.includes(p.rule) || (aliases[p.id] && rtLines.includes(aliases[p.id]))),
					p.rule)),
				row(_('Custom rules'), w.rtCustom, _('Additional rules, one per line')),
				row(_('Fallback'), w.rtFallback, _('Where unmatched traffic goes'))
			]),

			section(_('APIs'), null, [
				row(_('Clash API controller'), w.clashCtl, _('Empty disables the Clash-compatible API')),
				row(_('Clash secret'), w.clashSecret, _('Bearer token for the Clash API')),
				row(_('Clash external UI'), w.clashUi, _('Dashboard directory served by the Clash API')),
				row(_('Clash default mode'), w.clashMode),
				row(_('Management UI enabled'), w.apiEnabled),
				row(_('Management UI listen'), w.apiListen, _('IP:port for the embedded doona UI')),
				row(_('Management secret'), w.apiSecret, _('Static bearer token; exclusive with password login')),
				row(_('Password login'), w.apiPass, _('Recommended when listening beyond loopback')),
				row(_('Anonymous loopback'), w.apiAnon, _('Only valid on a loopback listen address')),
				row(_('Allowed origins'), w.apiOrigins, _("Comma separated quoted origins, e.g. 'https://panel.example'")),
				row(_('Allowed hosts'), w.apiHosts, _('Comma separated quoted Host values for reverse proxies')),
				row(_('Record flows'), w.apiFlows),
				row(_('Record traffic'), w.apiTraffic),
				row(_('Record memory'), w.apiMemory),
				row(_('Record logs'), w.apiLogs),
				row(_('Record DNS log'), w.apiDnsLog),
				row(_('Config write'), w.apiConfigWrite, _('Allow the API to replace config files; needs auth')),
				row(_('Persist runtime state'), w.cacheFile),
				row(_('Cache DNS state'), w.cacheDns)
			]),

			section(_('Assets'), _('Download defaults for geodata, the external UI and subscriptions.'), [
				row(_('Default route'), w.assetsRoute, _("routing, direct or a group name for downloads")),
				row(_('Geosite URL'), w.geositeUrl),
				row(_('Geoip URL'), w.geoipUrl),
				row(_('Geodata route'), w.geodataRoute, _('Overrides the default route for geodata fetches')),
				row(_('External UI URL'), w.uiUrl, _('Dashboard ZIP source')),
				row(_('External UI route'), w.uiRoute, _('Group or node tag used to fetch the dashboard')),
				row(_('Subscription UA'), w.subUa, _('User-Agent for subscription requests')),
				row(_('Subscription interval'), w.subInterval, _('Default refresh interval; 0 disables')),
				row(_('Subscription cache'), w.subCache)
			]),

			E('div', { 'class': 'right' }, E('button', {
				'class': 'btn cbi-button cbi-button-save',
				'click': gen
			}, _('Generate and save')))
		]);
	},

	/* Compose the entry file and hand it to the same save+reload path the
	   raw editor uses. */
	handleWizardSave() {
		const w = this.w;
		const parts = [];

		const g = [];
		const push = (k, v) => v !== '' && g.push('    ' + k + ': ' + q(v));
		push('wan_interface', val(w.wan));
		push('lan_interface', val(w.lan));
		push('log_level', val(w.logLevel));
		push('dial_mode', val(w.dialMode));
		push('tproxy_port', val(w.tproxyPort));
		push('auto_config_kernel_parameter', w.autoKernel.checked ? 'true' : 'false');
		push('nfqueue_enable', w.nfqueue.checked ? 'true' : 'false');
		push('store_subscribe', w.storeSub.checked ? 'true' : 'false');
		push('data_dir', val(w.dataDir));
		push('log_file', val(w.logFile));
		push('so_mark_from_dae', val(w.soMark));
		push('tls_implementation', val(w.tlsImpl));
		push('sniffing_timeout', val(w.sniffTimeout));
		if (w.allowInsecure.checked)
			push('allow_insecure', 'true');
		if (w.mptcp.checked)
			push('mptcp', 'true');
		push('tcp_check_url', val(w.tcpCheckUrl));
		push('tcp_check_http_method', val(w.tcpCheckMethod));
		push('udp_check_dns', val(w.udpCheckDns));
		push('check_interval', val(w.checkInterval));
		push('check_tolerance', val(w.checkTolerance));
		push('bootstrap_resolver', val(w.bootstrap));
		push('preconnect_node_count', val(w.preconnect));
		push('udp_warm_node_count', val(w.udpWarm));
		push('max_concurrent_dials', val(w.maxDials));
		parts.push('global {\n' + g.join('\n') + '\n}');

		const nodes = taggedLines(w.nodes.value, 'node');
		if (nodes.length)
			parts.push('node {\n' + nodes.join('\n') + '\n}');

		const subs = taggedLines(w.subs.value, 'sub');
		if (subs.length)
			parts.push('subscription {\n' + subs.join('\n') + '\n}');

		const gl = [];
		if (val(w.groupName)) {
			const gb = [ '        policy: ' + (val(w.groupPolicy) === 'fixed'
				? 'fixed(' + (val(w.groupFixedIndex) || '0') + ')' : val(w.groupPolicy)) ];
			if (val(w.groupFilter))
				gb.unshift('        filter: ' + val(w.groupFilter));
			if (val(w.groupFinal))
				gb.push('        final: ' + val(w.groupFinal));
			gl.push('    ' + val(w.groupName) + ' {\n' + gb.join('\n') + '\n    }');
		}
		for (const l of w.groupExtra.value.split('\n'))
			if (l.trim())
				gl.push('    ' + l);
		if (gl.length)
			parts.push('group {\n' + gl.join('\n') + '\n}');

		const dnsH = [];
		const dpush = (k, v) => v !== '' && dnsH.push('    ' + k + ': ' + q(v));
		dpush('bind', val(w.dnsBind));
		for (const l of w.dnsHosts.value.split('\n'))
			if (l.trim())
				dnsH.push('    use_host: ' + l.trim());
		dpush('client_subnet', val(w.clientSubnet));
		dpush('ipversion_prefer', val(w.ipVersion));
		dnsH.push('    optimistic_cache: ' + (w.optCache.checked ? 'true' : 'false'));
		dpush('optimistic_cache_ttl', val(w.optCacheTtl));
		dpush('optimistic_stale_reply_ttl', val(w.optStaleTtl));
		dpush('max_cache_size', val(w.maxCache));
		const ups = this.dnsPresets
			.filter(p => this.w['up_' + p.id].checked)
			.map(p => '        ' + p.id + ': ' + q(p.url)
				+ (p.detour === 'group' && val(w.groupName) ? ' -> ' + val(w.groupName) : ''));
		for (const l of w.upCustom.value.split('\n'))
			if (l.trim())
				ups.push('        ' + l.trim());
		const ttl = w.fixedTtl.value.split('\n').map(l => l.trim()).filter(Boolean)
			.map(l => '        ' + l).join('\n');
		const reqs = w.dnsReqRules.value.split('\n').map(l => l.trim()).filter(Boolean);
		const ress = w.dnsResRules.value.split('\n').map(l => l.trim()).filter(Boolean);
		parts.push('dns {\n'
			+ (dnsH.length ? dnsH.join('\n') + '\n' : '')
			+ '    upstream {\n' + ups.join('\n')
			+ '\n    }\n'
			+ (ttl ? '    fixed_domain_ttl {\n' + ttl + '\n    }\n' : '')
			+ '    routing {\n        request {\n'
			+ reqs.map(l => '            ' + l).join('\n')
			+ '\n            fallback: ' + val(w.dnsReqFallback)
			+ '\n        }\n        response {\n'
			+ ress.map(l => '            ' + l).join('\n')
			+ (ress.length ? '\n' : '') + '            fallback: ' + val(w.dnsResFallback)
			+ '\n        }\n    }\n}');

		const rules = this.rtPresets
			.filter(p => this.w['rt_' + p.id].checked)
			.map(p => '    ' + p.rule);
		for (const l of w.rtCustom.value.split('\n'))
			if (l.trim())
				rules.push('    ' + l.trim());
		rules.push('    fallback: ' + val(w.rtFallback));
		parts.push('routing {\n' + rules.join('\n') + '\n}');

		const exp = [];
		if (val(w.clashCtl)) {
			const ca = [ '        external_controller: ' + q(val(w.clashCtl)) ];
			if (val(w.clashSecret))
				ca.push('        secret: ' + q(val(w.clashSecret)));
			if (val(w.clashUi))
				ca.push('        external_ui: ' + q(val(w.clashUi)));
			ca.push('        default_mode: ' + q(val(w.clashMode)));
			exp.push('    clash_api {\n' + ca.join('\n') + '\n    }');
		}
		const api = [ '        enabled: ' + (w.apiEnabled.checked ? 'true' : 'false'),
			'        listen: ' + q(val(w.apiListen)) ];
		if (val(w.apiSecret))
			api.push('        secret: ' + q(val(w.apiSecret)));
		if (w.apiPass.checked)
			api.push('        password_auth: true');
		if (w.apiAnon.checked)
			api.push('        allow_anonymous_loopback: true');
		if (val(w.apiOrigins))
			api.push('        allow_origins: ' + val(w.apiOrigins));
		if (val(w.apiHosts))
			api.push('        allowed_hosts: ' + val(w.apiHosts));
		for (const [ k, box ] of [ [ 'record_flows', w.apiFlows ], [ 'record_traffic', w.apiTraffic ],
			[ 'record_memory', w.apiMemory ], [ 'record_logs', w.apiLogs ], [ 'record_dns_log', w.apiDnsLog ] ])
			if (!box.checked)
				api.push('        ' + k + ': false');
		if (w.apiConfigWrite.checked)
			api.push('        config_write: true');
		api.push("        ui: 'embedded'");
		exp.push('    native_api {\n' + api.join('\n') + '\n    }');
		if (w.cacheFile.checked) {
			exp.push('    cache_file {\n        enabled: true'
				+ (w.cacheDns.checked ? '\n        store_dns: true' : '') + '\n    }');
		}
		parts.push('experimental {\n' + exp.join('\n') + '\n}');

		const as = [];
		if (val(w.geositeUrl) || val(w.geoipUrl) || val(w.geodataRoute)) {
			const gb2 = [];
			if (val(w.geositeUrl)) gb2.push('        geosite: ' + q(val(w.geositeUrl)));
			if (val(w.geoipUrl)) gb2.push('        geoip: ' + q(val(w.geoipUrl)));
			if (val(w.geodataRoute)) gb2.push('        route: ' + val(w.geodataRoute));
			as.push('    geodata {\n' + gb2.join('\n') + '\n    }');
		}
		if (val(w.uiUrl) || val(w.uiRoute)) {
			const ub = [];
			if (val(w.uiUrl)) ub.push('        url: ' + q(val(w.uiUrl)));
			if (val(w.uiRoute)) ub.push('        route: ' + val(w.uiRoute));
			as.push('    ui {\n' + ub.join('\n') + '\n    }');
		}
		if (val(w.subUa) || val(w.subInterval) || !w.subCache.checked) {
			const sb = [];
			if (val(w.subUa)) sb.push('        ua: ' + q(val(w.subUa)));
			if (val(w.subInterval)) sb.push('        interval: ' + q(val(w.subInterval)));
			if (!w.subCache.checked) sb.push('        cache: false');
			as.push('    subscription {\n' + sb.join('\n') + '\n    }');
		}
		if (val(w.assetsRoute))
			as.unshift('    route: ' + val(w.assetsRoute));
		if (as.length)
			parts.push('assets {\n' + as.join('\n') + '\n}');

		const text = '# Generated by the luci-app-honk configuration wizard.\n\n' + parts.join('\n\n') + '\n';

		return fs.write(this.entry, text, 0o600)
			.then(() => this.applySaved())
			.then(() => this.refresh());
	}
});
