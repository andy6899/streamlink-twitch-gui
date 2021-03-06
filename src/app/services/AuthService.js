import {
	get,
	set,
	computed,
	inject,
	Evented,
	Service
} from "Ember";
import { twitch } from "config";
import nwWindow from "nwjs/Window";
import { openBrowser } from "nwjs/Shell";
import { all } from "utils/contains";
import HttpServer from "utils/node/http/Server";
import OAuthResponseRedirect from "root/oauth-redirect.html";


const { service } = inject;
const {
	oauth: {
		"base-uri": baseuri,
		"client-id": clientid,
		"server-port": serverport,
		"redirect-uri": redirecturi,
		"scope": scope
	}
} = twitch;

const reToken = /^[a-z\d]{30}$/i;


export default Service.extend( Evented, {
	store: service(),

	session: null,
	server: null,

	url: computed(function() {
		let redirect = redirecturi.replace( "{server-port}", String( serverport ) );

		return baseuri
			.replace( "{client-id}", clientid )
			.replace( "{redirect-uri}", encodeURIComponent( redirect ) )
			.replace( "{scope}", scope.join( "+" ) );
	}),


	init() {
		var store = get( this, "store" );
		store.findAll( "auth" )
			.then(function( records ) {
				return records.content.length
					? records.objectAt( 0 )
					: store.createRecord( "auth", { id: 1 } ).save();
			})
			.then(function( session ) {
				set( this, "session", session );

				// startup auto login
				var token = get( session, "access_token" );
				this.login( token, true )
					.catch(function() {});

				// trigger event after calling login, so `isPending` can be set first
				this.trigger( "initialized" );
			}.bind( this ) );
	},



	/**
	 * Signout and reset session
	 * @returns {Promise}
	 */
	signout() {
		this.updateAdapter( null );
		return this.sessionReset();
	},

	/**
	 * Open OAuth url in browser
	 * @returns {Promise}
	 */
	signin() {
		if ( get( this, "server" ) ) {
			return Promise.reject();
		}

		return new Promise( ( resolve, reject ) => {
			let server = new HttpServer( serverport, 1000 );
			set( this, "server", server );

			server.onRequest( "GET", "/redirect", ( req, res ) => {
				res.end( OAuthResponseRedirect );
				return true;
			});

			server.onRequest( "GET", "/token", ( req, res ) => {
				let { access_token: token, scope } = req.url.query;

				// validate token and scope and keep the request open
				this.validateOAuthResponse( token, scope )
					.finally( () => res.end() )
					.then( data => {
						// send 200
						resolve( data );
					}, err => {
						// send 500
						res.statusCode = 500;
						reject( err );
					});

				return true;
			});

			// open auth url in web browser
			let url = get( this, "url" );
			openBrowser( url );
		})
			// shut down server and focus the application window when done
			.finally( () => {
				this.abortSignin();
				nwWindow.focus();
			});
	},

	abortSignin() {
		let server = get( this, "server" );
		if ( !server ) { return; }
		server.close();
		set( this, "server", null );
	},

	/**
	 * Validate the OAuth response after a login attempt
	 * @param {string} token
	 * @param {string} scope
	 * @returns {Promise}
	 */
	validateOAuthResponse( token, scope ) {
		// check the returned token and validate scopes
		return token
		    && token.length > 0
		    && scope
		    && scope.length > 0
		    && this.validateScope( scope.split( " " ) )
			? this.login( token, false )
			: Promise.reject();
	},

	/**
	 * Update the adapter and try to authenticate with the given access token
	 * @param {string} token
	 * @param {boolean} isAutoLogin
	 * @returns {Promise}
	 */
	login( token, isAutoLogin ) {
		var self = this;

		// no token set
		if ( !token || !reToken.test( token ) ) { return Promise.reject(); }

		set( this, "session.isPending", true );

		// tell the twitch adapter to use the token from now on
		self.updateAdapter( token );

		// validate session
		return self.validateSession()
			// logged in...
			.then(function( record ) {
				var promise = isAutoLogin
					? Promise.resolve()
					// save auth record if this was no auto login
					: self.sessionSave( token, record );

				// also don't forget to set the user_name on the auth record (volatile)
				return promise.then(function() {
					var name = get( record, "user_name" );
					set( self, "session.user_name", name );
				});
			})
			// SUCCESS
			.then(function() {
				set( self, "session.isPending", false );
				self.trigger( "login", true );
			})
			// FAILURE: reset the adapter
			.catch(function( err ) {
				self.updateAdapter( null );
				set( self, "session.isPending", false );
				self.trigger( "login", false );

				return Promise.reject( err );
			});
	},

	/**
	 * Adapter was updated. Now check if the access token is valid.
	 * @returns {Promise}
	 */
	validateSession() {
		// validate token
		var store = get( this, "store" );
		return store.findAll( "twitchToken", { reload: true } )
			.then(function( records ) { return records.objectAt( 0 ); })
			.then( this.validateToken.bind( this ) );
	},

	/**
	 * Validate access token response
	 * @param {DS.Model} record
	 * @returns {Promise}
	 */
	validateToken( record ) {
		var valid = get( record, "valid" );
		var name  = get( record, "user_name" );
		var scope = get( record, "authorization.scopes" );

		return valid === true
		    && name
		    && name.length > 0
		    && this.validateScope( scope )
			? Promise.resolve( record )
			: Promise.reject( new Error( "Invalid access token" ) );
	},

	/**
	 * Received and expected scopes need to be identical
	 * @param {Array} returnedScope
	 * @returns {boolean}
	 */
	validateScope( returnedScope ) {
		return returnedScope instanceof Array
		    && all.apply( returnedScope, scope );
	},


	/**
	 * Update the auth record and save it
	 * @param {string} token
	 * @param {DS.Model} record
	 * @returns {Promise}
	 */
	sessionSave( token, record ) {
		var session = get( this, "session" );
		session.setProperties({
			access_token: token,
			scope       : get( record, "authorization.scopes" ).join( "+" ),
			date        : new Date()
		});
		return session.save();
	},

	/**
	 * Clear auth record and save it
	 * @returns {Promise}
	 */
	sessionReset() {
		var session = get( this, "session" );
		session.setProperties({
			access_token: null,
			scope       : null,
			date        : null,
			user_name   : null
		});
		return session.save();
	},


	updateAdapter( token ) {
		var adapter = get( this, "store" ).adapterFor( "twitch" );
		if ( !adapter ) {
			throw new Error( "Adapter not found" );
		}

		set( adapter, "access_token", token );
	}
});
