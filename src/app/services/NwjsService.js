import {
	get,
	inject,
	Service
} from "Ember";
import nwWindow, {
	toggleVisibility,
	toggleMaximize,
	toggleMinimize
} from "nwjs/Window";


const { service } = inject;


export default Service.extend({
	modal: service(),
	settings: service(),
	streaming: service(),


	reload() {
		nwWindow.reloadIgnoringCache();
	},

	devTools() {
		nwWindow.showDevTools();
	},

	minimize() {
		let integration    = get( this, "settings.gui_integration" );
		let minimizetotray = get( this, "settings.gui_minimizetotray" );

		// tray only or both with min2tray: just hide the window
		if ( integration === 2 || integration === 3 && minimizetotray ) {
			toggleVisibility( false );
		} else {
			toggleMinimize( false );
		}
	},

	maximize() {
		toggleMaximize();
	},

	close() {
		if ( get( this, "streaming.model.length" ) ) {
			get( this, "modal" ).openModal( "quit", this );
		} else {
			nwWindow.close( true );
		}
	}
});
