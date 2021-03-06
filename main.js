﻿require({
    packages: [
        {
            name: "jquery",
            location: "//ajax.googleapis.com/ajax/libs/jquery/1.9.0",
            main: "jquery.min"
        },
        {
            name: "underscore",
            location: "//cdnjs.cloudflare.com/ajax/libs/underscore.js/1.8.3",
            main: "underscore-min"
        }
    ]
});

define([
        "dojo/_base/declare",
        "dojo/Deferred",
        "dojo/promise/all",
        "jquery",
        "underscore",
        "dojo/text!./templates.html",
        "esri/layers/FeatureLayer",
        "esri/layers/ArcGISDynamicMapServiceLayer",
        "esri/layers/ArcGISTiledMapServiceLayer",
        "esri/layers/WMSLayer",
        "esri/layers/LayerDrawingOptions",
        "framework/PluginBase",
        "framework/util/ajax",
        //"./tests/index",
        "./draw_report/main",
        "./State",
        "./Config",
        "./Tree"
    ],
    function(declare,
             Deferred,
             all,
             $,
             _,
             templates,
             FeatureLayer,
             ArcGISDynamicMapServiceLayer,
             ArcGISTiledMapServiceLayer,
             WMSLayer,
             LayerDrawingOptions,
             PluginBase,
             ajaxUtil,
             //unitTests,
             DrawAndReport,
             State,
             Config,
             Tree) {
        "use strict";

        return declare(PluginBase, {
            toolbarName: "Regional Planning",
            fullName: "Configure and control layers to be overlayed on the base map.",
            toolbarType: "sidebar",
            allowIdentifyWhenActive: true,
            hasCustomPrint: true,

            initialize: function (frameworkParameters, currentRegion) {
                declare.safeMixin(this, frameworkParameters);

                this.drawReport = new DrawAndReport(this, $('<div>').get(0));

                this.pluginTmpl = _.template(this.getTemplateById('plugin'));
                this.layersPluginTmpl = _.template(this.getTemplateById('layers-plugin'));
                this.filterTmpl = _.template(this.getTemplateById('filter'));
                this.treeTmpl = _.template(this.getTemplateById('tree'));
                this.layerTmpl = _.template(this.getTemplateById('layer'));
                this.infoBoxTmpl = _.template(this.getTemplateById('info-box'));
                this.layerMenuTmpl = _.template(this.getTemplateById('layer-menu'));
                this.layerMenuId = _.uniqueId('layer-selector2-layer-menu-');

                this.state = new State();
                this.config = new Config();
                this.rebuildTree();

                this.bindEvents();
            },

            bindEvents: function() {
                this.bindTabEvents();
                this.bindTreeEvents();
                this.bindLayerMenuEvents();
            },

            bindTabEvents: function() {
                var self = this,
                    $el = $(this.container);
                $el.on('click', 'dl.tabs a', function() {
                    var tab = $(this).attr('data-tab');
                    self.state = self.state.setTab(tab);
                    self.render();
                });
            },

            bindTreeEvents: function() {
                var self = this;

                function toggleLayer() {
                    var layerId = self.getClosestLayerId(this),
                        layer = self.tree.findLayer(layerId);
                    self.toggleLayer(layer);
                }

                $(this.container)
                    .on('click', 'a.layer-row', toggleLayer)
                    .on('click', 'a.info', function() {
                        self.state = self.state.setInfoBoxLayerId(self.getClosestLayerId(this));
                        self.showLayerInfo();
                    })
                    .on('click', '.info-box .close', function() {
                        self.hideLayerInfo();
                    })
                    .on('click', 'a.more', function() {
                        self.showLayerMenu(this);
                        self.setActiveStateForLayerTools(this, '.more');
                    })
                    .on('keyup', 'input.filter', function() {
                        var $el = $(this),
                            filterText = $el.val();
                        self.applyFilter(filterText);
                    })
                    .on('click', 'a.reset', function() {
                        self.clearAll();
                    });
            },

            bindLayerMenuEvents: function() {
                var self = this;
                $('body')
                    .on('click', '#' + this.layerMenuId + ' a.download', function() {
                        var layerId = self.getClosestLayerId(this);
                        console.log('Download', layerId);
                        self.destroyLayerMenu();
                    })
                    .on('click', '#' + this.layerMenuId + ' a.zoom', function() {
                        self.zoomToLayerExtent(self.getClosestLayerId(this));
                        self.destroyLayerMenu();
                    })
                    .on('change', '#' + this.layerMenuId + ' .slider', function() {
                        var layerId = self.getClosestLayerId(this),
                            opacity = parseFloat($(this).find('input').val());
                        self.setLayerOpacity(layerId, opacity);
                    });
            },

            getClosestLayerId: function(el) {
                var $el = $(el),
                    $parent = $el.closest('[data-layer-id]'),
                    layerId = $parent.attr('data-layer-id');
                return layerId;
            },

            showLayerMenu: function(el) {
                var $el = $(el),
                    layerId = this.getClosestLayerId(el),
                    layer = this.tree.findLayer(layerId),
                    service = layer.getService(),
                    supportsOpacity = service.supportsOpacity(),
                    $menu = this._createLayerMenu(layerId),
                    $shadow = this._createLayerMenuShadow(),
                    position = this.determineLayerMenuPosition($el, layerId);

                $menu.css({
                    top: position.top,
                    left: position.left
                });

                if ($.i18n) {
                    $menu.localize();
                }

                $('body').append($shadow).append($menu);
            },

            _createLayerMenu: function(layerId) {
                var layer = this.tree.findLayer(layerId),
                    service = layer.getService(),
                    supportsOpacity = service.supportsOpacity(),
                    opacity = layer.getOpacity(),
                    html = this.layerMenuTmpl({
                        layer: layer,
                        id: this.layerMenuId,
                        opacity: opacity,
                        supportsOpacity: supportsOpacity
                    });
                return $(html);
            },

            _createLayerMenuShadow: function() {
                var $shadow = $('<div class="layer-selector2-layer-menu-shadow">');
                $shadow.on('click', _.bind(this.destroyLayerMenu, this));
                return $shadow;
            },

            destroyLayerMenu: function() {
                $('body').find('.layer-selector2-layer-menu').remove();
                $('body').find('.layer-selector2-layer-menu-shadow').remove();
                this.clearActiveStateForLayerTools('.more');
            },

            updateMap: function() {
                var selectedLayers = this.tree.findLayers(this.state.getSelectedLayers()),
                    visibleLayerIds = this.getVisibleLayers(selectedLayers);

                _.each(visibleLayerIds, function(layerServiceIds, serviceUrl) {
                    var mapLayer = this.map.getLayer(serviceUrl);

                    // Ignore feature group added by Draw & Report.
                    if (mapLayer instanceof esri.layers.GraphicsLayer) {
                        return;
                    }

                    if (layerServiceIds.length === 0) {
                        mapLayer.setVisibleLayers([]);
                    } else {
                        mapLayer.setVisibleLayers(layerServiceIds);
                    }
                }, this);

                this.setOpacityForSelectedLayers(selectedLayers);
            },

            // Return array of layer service IDs grouped by service URL.
            // ex. { serviceUrl: [id, ...], ... }
            getVisibleLayers: function(layers) {
                var visibleLayerIds = {};

                // Default existing layers to empty so that deselecting
                // all layers in a service will work correctly.
                _.each(this.map.getMyLayers(), function(mapLayer) {
                    visibleLayerIds[mapLayer.id] = [];
                });

                _.each(layers, function(layer) {
                    var service = layer.getService(),
                        serviceUrl = service.getServiceUrl(),
                        serviceId = layer.getServiceId();

                    if (_.isUndefined(serviceId)) {
                        return;
                    }

                    this.addServiceMapLayerIfNotExists(layer);

                    if (!visibleLayerIds[serviceUrl]) {
                        visibleLayerIds[serviceUrl] = [];
                    }

                    if (layer.isCombined()) {
                        _.each(layer.getChildren(), function(child) {
                            visibleLayerIds[serviceUrl].push(child.getServiceId());
                        });
                    } else {
                        visibleLayerIds[serviceUrl].push(layer.getServiceId());
                    }
                }, this);

                return visibleLayerIds;
            },

            setOpacityForSelectedLayers: function(layers) {
                // If the layers haven't been added to the map yet we can't proceed.
                if (_.isEmpty(layers)) { return; }

                var layerByService = _.groupBy(layers, function(layer) {
                        return layer.getService().getServiceUrl();
                    });

                _.each(layerByService, function(layers, serviceUrl) {
                    var service = layers[0].getService();
                    if (service.supportsOpacity()) {
                        var drawingOptions = this.getDrawingOptions(layers),
                            mapLayer = this.map.getLayer(serviceUrl);
                        mapLayer.setLayerDrawingOptions(drawingOptions);
                    }
                }, this);
            },

            getDrawingOptions: function(layers) {
                var self = this,
                    drawingOptions = _.reduce(layers, function(memo, layer) {
                        var drawingOption = new LayerDrawingOptions({
                                // 0 is totally opaque, 100 is 100% transparent.
                                // Opacity is stored as a decimal from 0 (transparent)
                                // to 1 (opaque) so we convert it and invert it here.
                                transparency: 100 - (layer.getOpacity() * 100)
                            });

                        memo[layer.getServiceId()] = drawingOption;

                        return memo;
                    }, []);
                return drawingOptions;
            },

            // Create service layer and add it to the map if it doesn't already exist.
            addServiceMapLayerIfNotExists: function(layer) {
                var server = layer.getServer(),
                    serviceUrl = layer.getService().getServiceUrl(),
                    mapLayer = this.map.getLayer(serviceUrl);

                // There's nothing to do if the service layer already exists.
                if (mapLayer) {
                    return;
                }

                mapLayer = this.createServiceMapLayer(server, serviceUrl);

                // Need to assign a deterministic ID, otherwise, the ESRI
                // JSAPI will generate a unique ID for us.
                mapLayer.id = serviceUrl;
                this.map.addLayer(mapLayer);
            },

            createServiceMapLayer: function(server, serviceUrl) {
                if (server.type === 'ags') {
                    if (server.layerType === 'dynamic') {
                        return new ArcGISDynamicMapServiceLayer(serviceUrl);
                    } else if (server.layerType === 'tiled') {
                        return new ArcGISTiledMapServiceLayer(serviceUrl);
                    } else if (server.layerType === 'feature-layer') {
                        return new FeatureLayer(serviceUrl);
                    } else {
                        throw new Error('AGS service layer type is not supported: ' + server.layerType);
                    }
                } else if (server.type === 'wms') {
                    return new WMSLayer(serviceUrl);
                } else {
                    throw new Error('Service type not supported: ' + server.type);
                }
            },

            render: function() {
                var $el = $(this.pluginTmpl({
                    tab: this.state.getTab()
                }));

                $el.find('.tab-layers').append($(this.layersPluginTmpl()));
                $el.find('.tab-report').append(this.drawReport.render());

                $(this.container).empty().append($el);
                this.renderLayerSelector();
            },

            renderLayerSelector: function() {
                this.renderFilter();
                this.renderTree();
                this.showLayerInfo();

                // Localize
                if ($.i18n) {
                    $(this.container).localize();
                }
            },

            renderFilter: function() {
                var html = this.filterTmpl({
                    filterText: this.state.getFilterText()
                });
                $(this.container).find('.filter-container').html(html);
            },

            renderTree: _.debounce(function() {
                var html = this.treeTmpl({
                    tree: this.filteredTree,
                    renderLayer: _.bind(this.renderLayer, this, 0)
                });
                $(this.container).find('.tree-container').html(html);
            }, 5),

            renderLayer: function(indent, layer) {
                var isSelected = layer.isSelected(),
                    isExpanded = layer.isExpanded(),
                    infoBoxIsDisplayed = layer.infoIsDisplayed();

                var cssClass = [];
                if (isSelected) {
                    cssClass.push('selected');
                }
                if (infoBoxIsDisplayed) {
                    cssClass.push('active');
                }
                cssClass.push(layer.isFolder() ? 'parent-node' : 'leaf-node');
                cssClass = cssClass.join(' ');

                return this.layerTmpl({
                    layer: layer,
                    cssClass: cssClass,
                    isSelected: isSelected,
                    isExpanded: isExpanded,
                    infoBoxIsDisplayed: infoBoxIsDisplayed,
                    indent: indent,
                    renderLayer: _.bind(this.renderLayer, this, indent + 1)
                });
            },

            getTemplateById: function(id) {
                return $('<div>').append(templates)
                    .find('#' + id)
                    .html().trim();
            },

            getState: function() {
                return {
                    layers: this.state.getState(),
                    drawReport: this.drawReport.getState()
                };
            },

            setState: function(data) {
                var self = this;

                var layerData = data.layers,
                    drawReportData = data.drawReport;

                this.state = new State(layerData);
                this.rebuildTree();
                this.renderLayerSelector();
                this.restoreSelectedLayers();

                this.drawReport.setState(drawReportData);
            },

            // Restore map service data for each selected layer
            // loaded from a saved state.
            restoreSelectedLayers: function() {
                var selectedLayers = this.state.getSelectedLayers(),
                    layerIds = _.reduce(selectedLayers, function(acc, layerId) {
                        // Map service data will be unavailable for on-demand
                        // layers that were persisted to state. Resolve this by
                        // also loading each parent layer.
                        return acc.concat(LayerNode.extractParentPaths(layerId));
                    }, []);

                _.each(layerIds, function(layerId) {
                    var layer = this.tree.findLayer(layerId);
                    if (layer) {
                        layer.getService().fetchMapService()
                            .then(this.requestReport.bind(this))
                            .then(this.rebuildTree.bind(this));
                    }
                }, this);
            },

            beforePrint: function(printDeferred) {
                // We can short circuit the plugin print chain by simply
                // rejecting this deferred object.
                printDeferred.reject();

                // Trigger an export dialog for this pane.
                this.app.dispatcher.trigger('export-map:pane-' + this.app.paneNumber);
            },

            showSpinner: function() {
                $(this.container).find('.tab-layers .loading').show();
            },

            hideSpinner: function() {
                $(this.container).find('.tab-layers .loading').hide();
            },

            // Fetch all map services so that on-demand layers are available
            // for filtering. (See issue #555)
            preload: function() {
                if (this._preloaded) {
                    return new Deferred().resolve();
                }

                // Create list of distinct service urls.
                var serviceUrls = {};
                this.tree.walk(function(layer) {
                    var service = layer.getService(),
                        serviceUrl = service.getServiceUrl();
                    serviceUrls[serviceUrl] = true;
                });

                var self = this,
                    defer = new Deferred();

                this.showSpinner();

                // Fetch all map services found.
                var promise = all(_.map(serviceUrls, function(v, serviceUrl) {
                    // Cache map service response.
                    var options = {};
                    if (serviceUrl.match(/WMS/i)) {
                        options.format = 'text';
                        options.content = '';
                    }

                    return ajaxUtil.fetch(serviceUrl, options);
                }));

                promise.always(function() {
                    self._preloaded = true;
                    self.rebuildTree();

                    // Let the loading animation play for at least 1 second
                    // before hiding to prevent flashing.
                    _.delay(function() {
                        self.hideSpinner();
                        defer.resolve();
                    }, 1000);
                });

                return defer.promise;
            },

            activate: function() {
                var self = this;

                this.render();

                this.preload().then(function() {
                    self.renderLayerSelector();
                });
            },

            deactivate: function() {
                this.drawReport.deactivate();
            },

            hibernate: function() {
                this.clearAll();
                this.drawReport.hibernate();
            },

            subregionActivated: function(currentRegion) {
                this.state = this.state.setCurrentRegion(currentRegion.id);
            },

            subregionDeactivated: function(currentRegion) {
                this.state = this.state.setCurrentRegion(null);
            },

            zoomToLayerExtent: function(layerId) {
                var self = this,
                    layer = this.tree.findLayer(layerId),
                    service = layer.getService();

                service.fetchLayerDetails(this.tree, layerId)
                    .then(function() {
                        self.rebuildTree();

                        var layer = self.tree.findLayer(layerId);
                        self.map.setExtent(layer.getExtent());
                    })
                    .otherwise(function(err) {
                        console.error(err);
                    });
            },

            showLayerInfo: function() {
                var layerId = this.state.getInfoBoxLayerId();
                if (!layerId) { return; }

                var self = this,
                    layer = this.tree.findLayer(layerId),
                    service = layer.getService();

                service.fetchLayerDetails(this.tree, layerId)
                    .then(function() {
                        self.rebuildTree();

                        var layer = self.tree.findLayer(layerId),
                            html = self.infoBoxTmpl({
                                layer: layer
                            });
                        $(self.container).find('.info-box-container').html(html);
                    })
                    .otherwise(function(err) {
                        console.error(err);
                    });
            },

            hideLayerInfo: function() {
                $(this.container).find('.info-box-container').empty();
                this.state = this.state.clearInfoBoxLayerId();
            },

            toggleLayer: function(layer) {
                var self = this;
                this.state = this.state.toggleLayer(layer);
                this.rebuildTree();
                layer.getService().fetchMapService().then(function() {
                    self.rebuildTree();
                });
                this.drawReport.update();
            },

            applyFilter: function(filterText) {
                var self = this;

                this.state = this.state.setFilterText(filterText).collapseAllLayers();
                this.rebuildTree();

                // Expand all layers that passed the filter.
                this.tree.walk(function(layer) {
                    self.state = self.state.expandLayer(layer.id());
                });
                this.rebuildTree();
            },

            clearAll: function() {
                this.state = new State();
                this.rebuildTree();
                this.renderLayerSelector();
                this.drawReport.clearAll();
            },

            setLayerOpacity: function(layerId, opacity) {
                this.state = this.state.setLayerOpacity(layerId, opacity);
                this.rebuildTree();
            },

            // Depending on what features are supported by the selected layer,
            // the top of the layer menu should be positioned differently.
            determineLayerMenuPosition: function($el, layerId) {
                var offset = $el.offset(),
                    layer = this.tree.findLayer(layerId),
                    service = layer.getService(),
                    supportsOpacity = service.supportsOpacity(),
                    top = offset.top;

                // Account for the height of the layer menu option if
                // the option won't be shown in the menu.
                if (!supportsOpacity) {
                    top = top + 59;
                }

                if (!layer.getDownloadUrl()) {
                    top = top + 32;
                }

                return {
                    top: top,
                    left: offset.left
                };
            },

            setActiveStateForLayerTools: function(el, selector) {
                this.clearActiveStateForLayerTools(selector);
                $(el).find('i').addClass('active');
                $(el).closest('[data-layer-id]').addClass('active');
                this.rebuildTree();
            },

            clearActiveStateForLayerTools: function(selector) {
                var completeSelector = '[data-layer-id].active ' + selector + ' i.active',
                    $el = $(this.container).find(completeSelector);

                $el.removeClass('active');
                $el.closest('[data-layer-id]').removeClass('active');
                this.rebuildTree();
            },

            // Rebuild tree from scratch.
            rebuildTree: function() {
                this.tree = this.config.getTree().update(this.state);
                // Need to maintain a separate filtered tree so that map
                // layers remain visible even after applying a filter.
                this.filteredTree = this.tree
                    .filterByRegion(this.state.getCurrentRegion())
                    .filterByName(this.state.getFilterText());
                this.renderTree();
                this.updateMap();
            },

            requestReport: function() {
                this.drawReport.queueRequestReport();
            }
        });
    }
);
