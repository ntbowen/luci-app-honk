'use strict';
'require daeuniverse.service as service';

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
		logIdent: /^honk(-core)?(\[\d+\])?: /
	}
});
