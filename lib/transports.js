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

const util = require('util');
const fsutil = require('./filestoreutils');
const unirest = require('unirest');
const CTS_BASE_URL = '/sap/bc/adt/cts/transports';
const AdtClient = require('./adt_client');
const XMLDocument = require('xmldoc').XmlDocument;

const log = require('fancy-log');

/**
 * creates and releases transport requests
 * @param {object}  oOptions
 * @param {object}  oOptions.conn               connection info
 * @param {string}  oOptions.conn.server        server url
 * @param {string}  oOptions.conn.client        sap client id
 * @param {boolean} oOptions.conn.useStrictSSL  force encrypted connection
 * @param {string}  oOptions.auth.user          username
 * @param {string}  oOptions.auth.pwd           password
 * @constructor
 */
class Transports{
    constructor(oOptions) {
        this.client = new AdtClient(oOptions.conn, oOptions.auth, undefined);
    }

    createTransport (sPackageName, sRequestText) {
        return new Promise(function(resolve, reject) {
            let that = this;
            let sPayload = this._getCreateTransportPayload(sPackageName, sRequestText);
            let sUrl = this.client.buildUrl(CTS_BASE_URL);
            this.client._determineCSRFToken(function (x) {
                let oRequest = unirest('POST', sUrl, {}, sPayload);
                oRequest.header('accept', '*/*');
                that.client.sendRequest(oRequest, function (oResponse) {
                    if (oResponse.status === fsutil.HTTPSTAT.ok) {
                        let transportNo = oResponse.body.split('/').pop();
                        log('Transport created: ' + transportNo );
                        resolve(transportNo);
                    } else {
                        reject(new Error(fsutil.createResponseError(oRequest, oResponse)));
                    }
                });
            });
        });


    }
    /**
     * Determines if a transport with the given texdt already exists. If true the callback returns the transport no
     * otherwise the cb returns null
     */
    determineExistingTransport() {
        return new Promise(function(resolve, reject) {
            let sUrl = this.client.buildUrl(CTS_BASE_URL + '?_action=FIND&trfunction=K');
            let oRequest = unirest('GET', sUrl, {});
            oRequest.header('accept', '*/*');
            this.client.sendRequest(oRequest, function (oResponse) {
                if (oResponse.status === fsutil.HTTPSTAT.ok) {
                    if (!oResponse.body) {
                        return fnCallback(null, null);
                    }
                    let oParsed = new XMLDocument(oResponse.body);
                    let transportNo = oParsed.valueWithPath('asx:values.DATA.CTS_REQ_HEADER.TRKORR');
                    log('Trasnport determined: ' + transportNo );
                    resolve(transportNo);
                } else {
                    reject(new Error(fsutil.createResponseError(oRequest, oResponse)));
                }
        });
        });
    }
    _getCreateTransportPayload(sPackageName, sRequestText) {
        let sTemplate = '<?xml version="1.0" encoding="UTF-8"?>' +
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">' +
            '<asx:values>' +
            '<DATA>' +
            '<OPERATION>I</OPERATION>' +
            '<DEVCLASS>%s</DEVCLASS>' +
            '<REQUEST_TEXT>%s</REQUEST_TEXT>' +
            '</DATA>' +
            '</asx:values>' +
            '</asx:abap>';
        return util.format(sTemplate, sPackageName, sRequestText);
    };
};

module.exports = Transports;
