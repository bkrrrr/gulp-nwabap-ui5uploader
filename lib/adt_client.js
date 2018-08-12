/*
 * Changed by Berncon GmbH, benedikt.kromer@berncon.com
 *
 * Original license text follows:
 * grunt-nwabap-ui5uploader
 * https://github.com/pfefferf/grunt-nwabap-ui5uploader
 *
 * Copyright (c) 2018 Florian Pfeffer
 * Licensed under the Apache-2.0 license.
 */

'use strict';

const unirest = require('unirest');
const util = require('./filestoreutils');
const backoff = require('backoff');
const log = require('fancy-log');
const c = require('ansi-colors');


let ADT_BASE_URL = '/sap/bc/adt/';


/**
 *
 * @param {object} oConnection
 * @param {string} oConnection.server
 * @param {string} oConnection.client
 * @param {boolean} oConnection.useStrictSSL
 * @param {object} oAuth
 * @param {string} oAuth.user
 * @param {string} oAuth.pwd
 * @param {string} [sLanguage]
 * @constructor
 */
function AdtClient(oConnection, oAuth, sLanguage) {
    this._oOptions = {
        auth: oAuth,
        conn: oConnection,
        lang: sLanguage
    };
}

/**
 * Construct the base Url for server access
 * @private
 * @return {string} base URL
 */
AdtClient.prototype._constructBaseUrl = function () {
    return this._oOptions.conn.server + ADT_BASE_URL;
};

/**
 * Determine a CSRF Token which is necessary for POST/PUT/DELETE operations; also the sapCookie is determined
 * @private
 * @param {function} fnCallback callback function
 * @return {void}
 */
AdtClient.prototype._determineCSRFToken = function (fnCallback) {
    if (this._sCSRFToken !== undefined) {
        fnCallback();
        return;
    }

    let oRequest = unirest.get(this.buildUrl(ADT_BASE_URL + 'discovery'));
    oRequest.headers({
        'X-CSRF-Token': 'Fetch',
        'accept': '*/*'
    });
    this.sendRequest(oRequest, function (oResponse) {
        if (oResponse.statusCode === util.HTTPSTAT.ok) {
            this._sCSRFToken = oResponse.headers['x-csrf-token'];
            this._sSAPCookie = oResponse.headers['set-cookie'];
        }
        fnCallback(util.createResponseError(oResponse));
    }.bind(this));
};

AdtClient.prototype.buildUrl = function (sUrl) {
    return this._oOptions.conn.server + sUrl;
};

/**
 * Send a request to the server (adds additional information before sending, e.g. authentication information)
 * @param {unirest} oRequest Unirest request object
 * @param {function} fnRequestCallback Callback for unirest request
 */
AdtClient.prototype.sendRequest = function (oRequest, fnRequestCallback) {
    let me = this;

    if (me._oOptions.auth) {
        oRequest.auth({ user: me._oOptions.auth.user, pass: me._oOptions.auth.pwd });
    }

    oRequest.strictSSL(me._oOptions.conn.useStrictSSL);

    if (me._oOptions.conn.client) {
        oRequest.query({
            'sap-client': encodeURIComponent(me._oOptions.conn.client)
        });
    }

    if (me._oOptions.lang) {
        oRequest.query({
            'sap-language': encodeURIComponent(me._oOptions.lang)
        });
    }

    if (!oRequest.hasHeader('x-csrf-token') && this._sCSRFToken) {
        oRequest.header('X-CSRF-Token', this._sCSRFToken);
    }

    if (!oRequest.hasHeader('cookie') && this._sSAPCookie) {
        oRequest.header('Cookie', this._sSAPCookie);
    }

    let call = backoff.call(oRequest.end, function (oResponse) {
        fnRequestCallback(oResponse);
    });

    call.retryIf(function (oResponse) {
        if (oResponse.error.syscall !== undefined) {
            log(c.red('[FAILED]'),'NW ABAP UI5 Uploader: Connection error has occurred, retrying (' + call.getNumRetries() + '): ' + JSON.stringify(oResponse.error));
            return true;
        }
        return false;
    });

    call.setStrategy(new backoff.ExponentialStrategy({
        initialDelay: 500,
        maxDelay: 50000
    }));

    call.failAfter(10);

    call.start();

};

module.exports = AdtClient;
