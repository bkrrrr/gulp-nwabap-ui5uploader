/*
 * Changed by ILC GmbH
 * Original license text follows:
 *
 * grunt-nwabap-ui5uploader
 * https://github.com/pfefferf/grunt-nwabap-ui5uploader
 *
 * Copyright (c) 2016 Florian Pfeffer
 * Licensed under the Apache-2.0 license.
 */

'use strict';

const async = require('async');
const log = require('fancy-log');
const c = require('ansi-colors');

const fs = require('fs');
const isBinaryFile = require('isbinaryfile');
const unirest = require('unirest');
const util = require('./filestoreutils');
const XMLDocument = require('xmldoc').XmlDocument;

const FILESTORE_BASE_URL = '/sap/bc/adt/filestore/ui5-bsp/objects';
const SLASH_ESCAPED = '%2f';

/**
 * FileStore constructor
 * @public
 * @param {object} oOptions Options for FileStore
 * @returns {FileStore}
 */
let FileStore = function (oOptions) {
    /*
     oOptions
     - conn:[server, client, useStrictSSL]
     - auth:[user, pwd]
     - ui5:[language, transportno, package, bspcontainer (max 15 chars), bspcontainer_text, calc_appindex]
     */

    // options
    this._oOptions = oOptions;
    // CSRF Token
    this._sCSRFToken = null;
    // SAP Cookie
    this._sSAPCookie = null;

    // remove suffix slashes from server URL
    if (this._oOptions.conn && this._oOptions.conn.server) {
        this._oOptions.conn.server = this._oOptions.conn.server.replace(/\/*$/, '');
    }
};

/**
 * Construct the base Url for server access
 * @private
 * @returns {string}
 */
FileStore.prototype._constructBaseUrl = function () {
    return this._oOptions.conn.server + FILESTORE_BASE_URL;
};

/**
 * Send a request to the server (adds additional information before sending, e.g. authentication information)
 * @private
 * @param {object} oRequest Unirest request object
 * @param {function} fnRequestCallback Callback for unirest request
 */
FileStore.prototype._sendRequest = function (oRequest, fnRequestCallback) {
    let me = this;

    if (me._oOptions.auth) {
        oRequest.auth({ user: me._oOptions.auth.user, pass: me._oOptions.auth.pwd });
    }

    if (me._oOptions.conn.client) {
        oRequest.query({
            'sap-client': encodeURIComponent(me._oOptions.conn.client)
        });
    }

    if (me._oOptions.ui5.language){
        oRequest.query({
            'sap-language': encodeURIComponent(me._oOptions.ui5.language.toUpperCase())
        });
    }

    oRequest.strictSSL(me._oOptions.conn.useStrictSSL);

    oRequest.end(fnRequestCallback);
};

/**
 * Determine a CSRF Token which is necessary for POST/PUT/DELETE operations; also the sapCookie is determined
 * @private
 * @param {function} fnCallback callback function
 */
FileStore.prototype._determineCSRFToken = function (fnCallback) {
    let me = this;

    if (me._sCSRFToken !== null) {
        fnCallback();
    } else {
        let oRequest = unirest.get(me._constructBaseUrl());
        oRequest.headers({
            'X-CSRF-Token': 'Fetch',
            'connection': 'keep-alive',
            'accept': '*/*'
        });
        me._sendRequest(oRequest, function (oResponse) {
            if (oResponse.statusCode === util.HTTPSTAT.ok) {
                me._sCSRFToken = oResponse.headers['x-csrf-token'];
                me._sSAPCookie = oResponse.headers['set-cookie'];
            }
            fnCallback(util.createResponseError(oRequest, oResponse));
        });
    }
};

/**
 * Get Metadata of BSP container
 * @public
 * @param {function} fnCallback callback function
 */
FileStore.prototype.getMetadataBSPContainer = function (fnCallback) {
    let sUrl = this._constructBaseUrl() + '/' + encodeURIComponent(this._oOptions.ui5.bspcontainer);
    let oRequest = unirest.get(sUrl);
    this._sendRequest(oRequest, function (oResponse) {
        fnCallback(util.createResponseError(oRequest, oResponse), oResponse);
    });
};

/**
 * Create BSP container
 * @public
 * @param {function} fnCallback callback function
 */
FileStore.prototype.createBSPContainer = function (fnCallback) {
    let me = this;

    async.series([
        me._determineCSRFToken.bind(me),
        me.getMetadataBSPContainer.bind(me)
    ], function (oError, aResult) {
        if (aResult[1].statusCode === util.HTTPSTAT.not_found) {
            // create BSP Container
            let sUrl = me._constructBaseUrl() +
                '/%20/content?type=folder&isBinary=false' +
                '&name=' + encodeURIComponent(me._oOptions.ui5.bspcontainer) +
                '&description=' + encodeURIComponent(me._oOptions.ui5.bspcontainer_text) +
                '&devclass=' + encodeURIComponent(me._oOptions.ui5.package);

            if (me._oOptions.ui5.transportno) {
                sUrl += '&corrNr=' + encodeURIComponent(me._oOptions.ui5.transportno);
            }

            let oRequest = unirest.post(sUrl);
            oRequest.headers(
                {
                    'X-CSRF-Token': me._sCSRFToken,
                    'Content-Type': 'application/octet-stream',
                    'Accept-Language': 'en-EN',
                    'accept': '*/*',
                    'Cookie': me._sSAPCookie
                }
            );

            me._sendRequest(oRequest, function (oResponse) {
                let msg = 'BSP-Container ' + me._oOptions.ui5.bspcontainer + ' created.';
                if (oResponse.statusCode === util.HTTPSTAT.created || oResponse.statusCode === util.HTTPSTAT.not_allowed) {
                    log(c.green('[OK]'), msg);
                    fnCallback(null, oResponse);
                } else {
                    log(c.red('[FAILED]'), msg);
                    fnCallback(util.createResponseError(oRequest, oResponse), oResponse);
                }
            });
        } else {
            fnCallback(oError);
        }
    });
};

/**
 * Re-calculate SAPUI5 ABAP Repository Application Index
 * @public
 * @param {function} fnCallback callback function
 */
FileStore.prototype.calcAppIndex = function (fnCallback) {

    if (!this._oOptions.ui5.calc_appindex) {
        // Option to recalculate the application index is not enabled - simply fire the callback
        fnCallback(null, null);
        return;
    }

    // Create the URL for appindex recalculation
    let sUrl = this._oOptions.conn.server + '/sap/bc/adt/filestore/ui5-bsp/appindex/' + encodeURIComponent(this._oOptions.ui5.bspcontainer);

    let oRequest = unirest.post(sUrl);
    oRequest.headers(
        {
            'X-CSRF-Token': this._sCSRFToken,
            'Content-Type': 'application/octet-stream',
            'Accept-Language': 'en-EN',
            'accept': '*/*',
            'Cookie': this._sSAPCookie
        }
    );

    this._sendRequest(oRequest, function (oResponse) {
        let msg = 'Calculating application index.';
        if (oResponse.statusCode === util.HTTPSTAT.ok) {
            log(c.green('[OK]'), msg);
            fnCallback(null, oResponse);
        } else {
            log(c.red('[FAILED]'), msg);
            fnCallback(util.createResponseError(oRequest, oResponse), oResponse);
        }
    });
};

/**
 * Synchronize files
 * @public
 * @param {Array} aFiles Files to be synchronized with server
 * @param {string} sCwd base folder
 * @param {function} fnCallback callback function
 */
FileStore.prototype.syncFiles = function (aFiles, sCwd, fnCallback) {
    let aArtifactsLocal = util.structureResolve(aFiles, '/');
    let aArtifactsServer = [];
    let aArtifactsSync = [];
    let aArtifactsSyncWork = [];

    let me = this;

    async.series([
        // L1, step 1: determine artifacts which have to be uploaded
        function (fnCallbackAsyncL1) {

            async.series([
                // L2, step 1: get files from server
                function (fnCallbackAsyncL2) {
                    let aFolders = [];
                    aFolders.push(me._oOptions.ui5.bspcontainer);

                    async.whilst(
                        function () {
                            return aFolders.length > 0;
                        },
                        function (fnCallbackAsyncL3) {
                            let sFolder = aFolders.shift();

                            let oRequest = unirest.get(me._constructBaseUrl() + '/' + encodeURIComponent(sFolder) + '/content');

                            me._sendRequest(oRequest, function (oResponse) {
                                if (oResponse.statusCode === util.HTTPSTAT.not_found) { //BSP container does not exist
                                    fnCallbackAsyncL3(null, oResponse);
                                    return;
                                }

                                if (oResponse.statusCode !== util.HTTPSTAT.ok) {
                                    fnCallbackAsyncL3(util.createResponseError(oRequest, oResponse), oResponse);
                                    return;
                                }

                                let oXML = new XMLDocument(oResponse.body);
                                let oAtomEntry = oXML.childrenNamed('atom:entry');

                                oAtomEntry.forEach(function (oChild) {
                                    let sCurrId = oChild.valueWithPath('atom:id');
                                    let sCurrType = oChild.valueWithPath('atom:category@term');

                                    aArtifactsServer.push({ type: sCurrType, id: sCurrId });

                                    if (sCurrType === util.OBJECT_TYPE.folder) {
                                        aFolders.push(sCurrId);
                                    }
                                });

                                fnCallbackAsyncL3(null, oResponse);
                            });
                        },
                        function (oError, oResult) {
                            aArtifactsServer = aArtifactsServer.map(function (oItem) {
                                let sId = oItem.id;

                                //remove bsp container at the beginning
                                if (encodeURIComponent(me._oOptions.ui5.bspcontainer).includes('%2F')) {
                                    sId = sId.replace('%2f', '%2F');
                                    sId = sId.replace('%2f', '%2F');
                                }

                                sId = sId.replace(encodeURIComponent(me._oOptions.ui5.bspcontainer), '');
                                let aValues = sId.split(SLASH_ESCAPED);

                                //remove empty values at the beginning (possible in case of a namespace with slashes)
                                if (aValues[0] === '') {
                                    aValues.shift();
                                }

                                oItem.id = '/' + aValues.join('/');
                                return oItem;
                            });

                            fnCallbackAsyncL2(oError, oResult);
                        }
                    );
                },

                // L2, step 2: compare against resolved artifacts
                function (fnCallbackAsyncL2) {
                    aArtifactsLocal.forEach(function (oItemLocal) {
                        let bFound = false;

                        aArtifactsServer.forEach(function (oItemServer) {
                            if (oItemLocal.type === oItemServer.type && oItemLocal.id === oItemServer.id) {
                                bFound = true;
                                aArtifactsSync.push({
                                    type: oItemLocal.type,
                                    id: oItemLocal.id,
                                    modif: util.MODIDF.update
                                });
                            }
                        });

                        if (bFound === false) {
                            aArtifactsSync.push({
                                type: oItemLocal.type,
                                id: oItemLocal.id,
                                modif: util.MODIDF.create
                            });
                        }
                    });

                    aArtifactsServer.forEach(function (oItemServer) {
                        let bFound = false;

                        aArtifactsLocal.forEach(function (oItemLocal) {
                            if (oItemLocal.type === oItemServer.type && oItemLocal.id === oItemServer.id) {
                                bFound = true;
                            }
                        });

                        if (bFound === false) {
                            aArtifactsSync.push({
                                type: oItemServer.type,
                                id: oItemServer.id,
                                modif: util.MODIDF.delete
                            });
                        }
                    });

                    fnCallbackAsyncL2(null, null);
                }

            ], function (oError, oResult) {
                fnCallbackAsyncL1(oError, oResult);
            });

        },

        // L1, step 2: order artifacts for processing
        function (fnCallbackAsyncL1) {
            /*
             order of artifacts
             1) DELETE files
             2) DELETE folders (starting with upper levels)
             3) CREATE folders (starting with lower levels)
             4) UPDATE folders -> not supported by ADT; but added to flow for completeness
             5) CREATE files
             6) UPDATE files
             */

            // level counter
            aArtifactsSync = aArtifactsSync.map(function (oItem) {
                oItem.levelCount = oItem.id.split('/').length - 1;
                return oItem;
            });

            // sort
            let aDeleteFiles = aArtifactsSync.filter(function (oItem) {
                return (oItem.type === util.OBJECT_TYPE.file && oItem.modif === util.MODIDF.delete);
            });
            let aDeleteFolders = aArtifactsSync.filter(function (oItem) {
                return (oItem.type === util.OBJECT_TYPE.folder && oItem.modif === util.MODIDF.delete);
            }).sort(function (oItem1, oItem2) {
                if (oItem1.levelCount > oItem2.levelCount) {
                    return -1;
                }
                if (oItem1.levelCount < oItem2.levelCount) {
                    return 1;
                }
                return 0;
            });

            let aCreateFolders = aArtifactsSync.filter(function (oItem) {
                return (oItem.type === util.OBJECT_TYPE.folder && oItem.modif === util.MODIDF.create);
            }).sort(function (oItem1, oItem2) {
                if (oItem1.levelCount < oItem2.levelCount) {
                    return -1;
                }
                if (oItem1.levelCount > oItem2.levelCount) {
                    return 1;
                }
                return 0;
            });
            let aUpdateFolders = aArtifactsSync.filter(function (oItem) {
                return (oItem.type === util.OBJECT_TYPE.folder && oItem.modif === util.MODIDF.update);
            });
            let aCreateFiles = aArtifactsSync.filter(function (oItem) {
                return (oItem.type === util.OBJECT_TYPE.file && oItem.modif === util.MODIDF.create);
            });
            let aUpdateFiles = aArtifactsSync.filter(function (oItem) {
                return (oItem.type === util.OBJECT_TYPE.file && oItem.modif === util.MODIDF.update);
            });

            aArtifactsSync = aDeleteFiles.concat(aDeleteFolders, aCreateFolders, aUpdateFolders, aCreateFiles, aUpdateFiles);
            aArtifactsSyncWork = aArtifactsSync.slice(0);

            fnCallbackAsyncL1(null, null);
        },

        // L1, step 3: create BSP container
        function (fnCallbackAsyncL1) {
            async.series([
                me.createBSPContainer.bind(me)
            ], function (oError, oResult) {
                fnCallbackAsyncL1(oError, oResult);
            });
        },

        // L1, step 4: do synchronization of folders and files
        function (fnCallbackAsyncL1) {

            async.whilst(
                function () {
                    return aArtifactsSyncWork.length > 0;
                },
                function (fnCallbackAsyncL2) {
                    let oItem = aArtifactsSyncWork.shift();

                    switch (oItem.type) {
                        case util.OBJECT_TYPE.folder:
                            me.syncFolder(oItem.id, oItem.modif, fnCallbackAsyncL2);
                            break;

                        case util.OBJECT_TYPE.file:
                            me.syncFile(oItem.id, oItem.modif, sCwd, fnCallbackAsyncL2);
                            break;
                    }

                },
                function (oError, oResult) {
                    fnCallbackAsyncL1(oError, oResult);
                }
            );
        },

        // L1, step 5: ensure UI5 Application Index is updated
        function (fnCallbackAsyncL1) {
            async.series([
                me.calcAppIndex.bind(me)
            ], function (oError, oResult) {
                fnCallbackAsyncL1(oError, oResult);
            });
        }

    ], function (oError) {
        fnCallback(oError, aArtifactsSync);
    });
};

/**
 * Sync folder
 * @public
 * @param {string} sFolder folder
 * @param {string} sModif modification type (create/update/delete)
 * @param {function} fnCallback callback function
 */
FileStore.prototype.syncFolder = function (sFolder, sModif, fnCallback) {
    let me = this;

    let oRequest = null;
    let sUrl = null;

    switch (sModif) {
        case util.MODIDF.create:
            sUrl = me._constructBaseUrl() +
                '/' + encodeURIComponent(me._oOptions.ui5.bspcontainer) + encodeURIComponent(util.splitIntoPathAndObject(sFolder).path) +
                '/content?type=folder&isBinary=false' +
                '&name=' + encodeURIComponent(util.splitIntoPathAndObject(sFolder).obj) +
                '&devclass=' + encodeURIComponent(me._oOptions.ui5.package);

            if (me._oOptions.ui5.transportno) {
                sUrl += '&corrNr=' + encodeURIComponent(me._oOptions.ui5.transportno);
            }

            oRequest = unirest.post(sUrl);

            oRequest.headers(
                {
                    'X-CSRF-Token': me._sCSRFToken,
                    'Content-Type': 'application/octet-stream',
                    'Accept-Language': 'en-EN',
                    'accept': '*/*',
                    'Cookie': me._sSAPCookie
                });

            break;

        case util.MODIDF.update:
            // no action, update not supported by ADT
            fnCallback(null, null);
            return;

        case util.MODIDF.delete:
            sUrl = me._constructBaseUrl() +
                '/' + encodeURIComponent(me._oOptions.ui5.bspcontainer) + encodeURIComponent(sFolder) +
                '/content' +
                '?deleteChildren=true';

            if (me._oOptions.ui5.transportno) {
                sUrl += '&corrNr=' + encodeURIComponent(me._oOptions.ui5.transportno);
            }

            oRequest = unirest.delete(sUrl);
            oRequest.headers(
                {
                    'X-CSRF-Token': me._sCSRFToken,
                    'Content-Type': 'application/octet-stream',
                    'Accept-Language': 'en-EN',
                    'accept': '*/*',
                    'Cookie': me._sSAPCookie,
                    'If-Match': '*'
                });

            break;

        default:
            fnCallback('Not supported modification indicator for folder specified', null);
            return;
    }

    me._sendRequest(oRequest, function (oResponse) {
        if (oResponse.error) {
            log(c.red('[FAILED]'), 'Folder', c.cyan(sFolder), sModif + 'd.');
            fnCallback(util.createResponseError(oRequest, oResponse), oResponse);
        } else {
            log(c.green('[OK]'), 'Folder', c.cyan(sFolder), sModif + 'd.');
            fnCallback(null, oResponse);
        }
    });

};

/**
 * Sync file
 * @public
 * @param {string} sFile file
 * @param {string} sModif modification type (create/update/delete)
 * @param {string} sCwd base folder
 * @param {function} fnCallback callback functiona
 */
FileStore.prototype.syncFile = function (sFile, sModif, sCwd, fnCallback) {
    let me = this;

    let oRequest = null;
    let sUrl = null;
    let oFileContent = null;
    let bBinaryFile = false;

    if (sModif === util.MODIDF.create || sModif === util.MODIDF.update) {
        //let filename = path.join(sCwd, sFile); //ILCDBO
        let filename = sCwd + sFile; //ILCDBO
        oFileContent = fs.readFileSync(filename);

        bBinaryFile = (isBinaryFile.sync(filename)) ? true : false;
    }

    switch (sModif) {
        case util.MODIDF.create:
            sUrl = me._constructBaseUrl() +
                '/' + encodeURIComponent(me._oOptions.ui5.bspcontainer) + encodeURIComponent(util.splitIntoPathAndObject(sFile).path) +
                '/content?type=file' +
                '&isBinary=' + bBinaryFile +
                '&name=' + encodeURIComponent(util.splitIntoPathAndObject(sFile).obj) +
                '&devclass=' + encodeURIComponent(me._oOptions.ui5.package) +
                '&charset=UTF-8';

            if (me._oOptions.ui5.transportno) {
                sUrl += '&corrNr=' + encodeURIComponent(me._oOptions.ui5.transportno);
            }

            oRequest = unirest.post(sUrl);
            oRequest.headers(
                {
                    'X-CSRF-Token': me._sCSRFToken,
                    'Content-Type': 'application/octet-stream',
                    'Accept-Language': 'en-EN',
                    'accept': '*/*',
                    'Cookie': me._sSAPCookie
                });

            if (oFileContent.length > 0) {
                oRequest.send(oFileContent);
            } else {
                oRequest.send(' ');
            }

            break;

        case util.MODIDF.update:
            sUrl = me._constructBaseUrl() +
                '/' + encodeURIComponent(me._oOptions.ui5.bspcontainer) + encodeURIComponent(sFile) +
                '/content' +
                '?isBinary=' + bBinaryFile +
                '&charset=UTF-8';

            if (me._oOptions.ui5.transportno) {
                sUrl += '&corrNr=' + encodeURIComponent(me._oOptions.ui5.transportno);
            }

            oRequest = unirest.put(sUrl);
            oRequest.headers(
                {
                    'X-CSRF-Token': me._sCSRFToken,
                    'Content-Type': 'application/octet-stream',
                    'Accept-Language': 'en-EN',
                    'accept': '*/*',
                    'Cookie': me._sSAPCookie,
                    'If-Match': '*'
                });

            if (oFileContent.length > 0) {
                oRequest.send(oFileContent);
            } else {
                oRequest.send(' ');
            }

            break;

        case util.MODIDF.delete:
            sUrl = me._constructBaseUrl() +
                '/' + encodeURIComponent(me._oOptions.ui5.bspcontainer) + encodeURIComponent(sFile) +
                '/content';

            if (me._oOptions.ui5.transportno) {
                sUrl += '?corrNr=' + encodeURIComponent(me._oOptions.ui5.transportno);
            }

            oRequest = unirest.delete(sUrl);
            oRequest.headers(
                {
                    'X-CSRF-Token': me._sCSRFToken,
                    'Content-Type': 'application/octet-stream',
                    'Accept-Language': 'en-EN',
                    'accept': '*/*',
                    'Cookie': me._sSAPCookie,
                    'If-Match': '*'
                });

            break;

        default:
            fnCallback('Not supported modification indicator for file specified', null);
            return;
    }

    me._sendRequest(oRequest, function (oResponse) {
        if (oResponse.error) {
            log(c.red('[FAILED]'), 'File', c.cyan(sFile), sModif + 'd.');
            fnCallback(util.createResponseError(oRequest, oResponse), oResponse);
        } else {
            log(c.green('[OK]'), 'File', c.cyan(sFile), sModif + 'd.');
            fnCallback(null, oResponse);
        }
    });

};

/**
 * export
 */
module.exports = FileStore;
