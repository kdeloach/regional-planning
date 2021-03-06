﻿define([
        "dojo/_base/declare",
        "dojo/json",
        "use!tv4",
        "underscore",
        "./LayerNode",
        "./schema",
        "dojo/text!./layers.json",
        "./util",
        "./Tree"
    ],
    function(declare, JSON, tv4, _,
             LayerNode,
             layerConfigSchema,
             layerSourcesJson,
             util,
             Tree) {
        "use strict";

        return declare(null, {
            constructor: function () {
                var rawNodes = this.parse(layerSourcesJson),
                    layers = _.map(rawNodes, function(node) {
                        return LayerNode.fromJS(node);
                    });
                this.tree = new Tree(layers);
            },

            parse: function(json) {
                var errorMessage;
                try {
                    var data = JSON.parse(json),
                        valid = tv4.validate(data, layerConfigSchema);
                    if (valid) {
                        return data;
                    } else {
                        errorMessage = tv4.error.message + " (data path: " + tv4.error.dataPath + ")";
                    }
                } catch (e) {
                    errorMessage = e.message;
                }
                console.error(errorMessage);
                return null;
            },

            getTree: function() {
                return this.tree;
            }
        });
    }
);