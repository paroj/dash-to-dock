const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Workspace = imports.ui.workspace;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const ViewSelector = imports.ui.viewSelector;
const Layout = imports.ui.layout;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const AppIcons = Me.imports.appIcons;

var AppExposeOverview = new Lang.Class({
	Name: 'DashToDock.AppExposeOverview',

	_init: function() {
		this.isInAppExposeOverview = false;
		this.originalTriggerSearchFunction = ViewSelector.ViewSelector.prototype._shouldTriggerSearch;
		this.originalOverviewFunction = Workspace.Workspace.prototype._isOverviewWindow;
		this.originalThumbnailFunction = WorkspaceThumbnail.WorkspaceThumbnail.prototype._isOverviewWindow;
		this.originalHotCornerToggleFunction = Layout.HotCorner.prototype._toggleOverview;
		this.hiddenId = Main.overview.connect('hidden', this._onOverviewHidden.bind(this));
		this.pageChangeId = Main.overview.viewSelector.connect('page-changed', this._onPageChanged.bind(this));
	},

	disconnect: function() {
		Main.overview.disconnect(this.hiddenId);
		Main.overview.viewSelector.disconnect(this.pageChangeId);
	},

	toggleAppExposeOverview: function (iconActor, appWindows) {
		if (Main.overview._shown) {
			// Notice: restoring original overview state is done in overview "hide" event handler
			Main.overview.hide();
		} else {
			// Switch from desktop to AppExpose:
			this.show(iconActor, appWindows);
		}
	},

	show: function(iconActor, appWindows) {
		// Checked in overview "hide" event handler
		this.isInAppExposeOverview = true;
		// Temporary change app icon scroll to switch workspaces
		this.actor = iconActor;
		this.appIconScrollId = this.actor.connect('scroll-event', this._onScrollInAppExposeOverview.bind(this));

		// Hide and disable search input
		// now done in _onPageChanged

		// Only show application windows in workspace
		this.appWindows = appWindows;
		const originalOverviewFunction = this.originalOverviewFunction;
		Workspace.Workspace.prototype._isOverviewWindow = function(metaWindow) {
			const originalResult = originalOverviewFunction(metaWindow);
			return originalResult && appWindows.indexOf(metaWindow) > -1;
		};

		// Only show application windows in thumbnails
		const originalThumbnailFunction = this.originalOverviewFunction;
		WorkspaceThumbnail.WorkspaceThumbnail.prototype._isOverviewWindow = function(metaWindow) {
			const originalResult = originalThumbnailFunction(metaWindow);
			return originalResult && appWindows.indexOf(metaWindow) > -1;
		};

		// If second last app window closed in AppExposeOverview, activate remaining window (done in hidden event)
		this.destroyWindowId = global.window_manager.connect('destroy', (windowActor) => {
			const metaWindow = windowActor.get_meta_window();
			const index = appWindows.indexOf(metaWindow);
			if (index > -1) {
				appWindows.splice(index, 1);
			}
			if (appWindows.length === 1) {
				Main.overview.hide();
			}
		});

		Main.overview.show();

		// Change hotcorner to show 'normal' overview, if in AppExposeOverview
		Layout.HotCorner.prototype._toggleOverview = function() {
			if (this._monitor.inFullscreen)
				return;

			if (Main.overview.shouldToggleByCornerOrButton()) {
				this._rippleAnimation();
				Main.overview._shown = false;
				Main.overview.emit('hiding');
				Main.overview._hideDone();
				Main.overview.show();
			}
		};
		Main.layoutManager._updateHotCorners();
	},

	_onOverviewHidden: function() {
		if (this.isInAppExposeOverview) {
			this.isInAppExposeOverview = false;
			// Restore original behaviour
			this.actor.disconnect(this.appIconScrollId);
			Layout.HotCorner.prototype._toggleOverview = this.originalHotCornerToggleFunction;
			Main.layoutManager._updateHotCorners();
			Main.overview.searchEntry.show();
			ViewSelector.ViewSelector.prototype._shouldTriggerSearch = this.originalTriggerSearchFunction;
			Workspace.Workspace.prototype._isOverviewWindow = this.originalOverviewFunction;
			WorkspaceThumbnail.WorkspaceThumbnail.prototype._isOverviewWindow = this.originalThumbnailFunction;
			global.window_manager.disconnect(this.destroyWindowId);
			// Check reason for leaving AppExposeOverview was second last window closed
			if (this.appWindows.length === 1) {
				Main.activateWindow(this.appWindows[0]);
			}
			// Add fade in when expose finished hiding,
			// so non app expose windows dont suddenly pop up
			this._getNonExposeWindows().forEach(function (w) {
				const originalX = w.x;
				const originalY = w.y;

				const monitorArea = global.display.get_monitor_geometry(w.get_meta_window().get_monitor())

				// version 1: start scaling non expose windows from monitor center
				// const startScaleX = monitorArea.x + monitorArea.width/2;
				// const startScaleY = monitorArea.y + monitorArea.height/2;

				// version 2: start scaling non expose windows from monitor top left:
				const startScaleX = monitorArea.x;
				const startScaleY = monitorArea.y;

				w.scale_x = 0,
				w.scale_y = 0;
				w.x = startScaleX;
				w.y = startScaleY;

				w.ease({
					x: originalX,
					y: originalY,
					scale_x: 1,
					scale_y: 1,
					duration: 0.125 * 1000,
					mode: Clutter.AnimationMode.LINEAR,
				});
			});
		}
	},

	_getNonExposeWindows: function() {
		return global.get_window_actors().filter(function(w) {
			return this.appWindows.indexOf(w.get_meta_window()) < 0;
		}, this);
	},

	_onScrollInAppExposeOverview: function(actor, event) {
		if (this.isInAppExposeOverview) {
			let direction = AppIcons.unifyScrollDirection(event);
			let activeWs = global.workspace_manager.get_active_workspace();
			let ws;
			switch (direction) {
				case Meta.MotionDirection.UP:
					ws = activeWs.get_neighbor(Meta.MotionDirection.UP);
					break;
				case Meta.MotionDirection.DOWN:
					ws = activeWs.get_neighbor(Meta.MotionDirection.DOWN);
					break;
				default:
					return Clutter.EVENT_PROPAGATE;
			}
			Main.wm.actionMoveWorkspace(ws);
			return Clutter.EVENT_STOP;
		}
		return Clutter.EVENT_PROPAGATE;
	},

	_onPageChanged: function() {
		let activePage = Main.overview.viewSelector.getActivePage();
		let isAppsPage = activePage == ViewSelector.ViewPage.APPS;
		let isSearchPage = activePage == ViewSelector.ViewPage.SEARCH;
		let showSearch = (isAppsPage || isSearchPage);
		if (this.isInAppExposeOverview) {
			if (showSearch) {
				Main.overview.searchEntry.show();
				ViewSelector.ViewSelector.prototype._shouldTriggerSearch = this.originalTriggerSearchFunction;
			} else {
				this._disableSearch();
			}
		}
	},

	_disableSearch: function() {
			Main.overview.searchEntry.hide();
			ViewSelector.ViewSelector.prototype._shouldTriggerSearch = function(symbol) {
				return false;
			};
	}
});
