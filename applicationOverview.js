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

const ApplicationOverview = new Lang.Class({
	Name: 'DashToDock.ApplicationOverview',

	_init: function() {
		this.isInAppOverview = false;
		this.originalTriggerSearchFunction = ViewSelector.ViewSelector.prototype._shouldTriggerSearch;
		this.originalOverviewFunction = Workspace.Workspace.prototype._isOverviewWindow;
		this.originalThumbnailFunction = WorkspaceThumbnail.WorkspaceThumbnail.prototype._isOverviewWindow;
		this.originalHotCornerToggleFunction = Layout.HotCorner.prototype._toggleOverview;
		this.hiddenId = Main.overview.connect('hidden', Lang.bind(this, this._onOverviewHidden));
	},

	disconnect: function() {
		Main.overview.disconnect(this.hiddenId);
	},

	toggleSelectedAppOverview: function (iconActor, appWindows) {
		if (Main.overview._shown) {
			// Notice: restoring original overview state is done in overview "hide" event handler
			Main.overview.hide();
		} else {
			// Checked in overview "hide" event handler
			this.isInAppOverview = true;
			// Temporary change app icon scroll to switch workspaces
			this.actor = iconActor;
			this.appIconScrollId = this.actor.connect('scroll-event', Lang.bind(this, this._onApplicationWorkspaceScroll));

			// Hide and disable search input
			Main.overview._searchEntryBin.hide();
			ViewSelector.ViewSelector.prototype._shouldTriggerSearch = function(symbol) {
				return false;
			};

			// Only show application windows in workspace
			this.appWindows = appWindows;
			const originalOverviewFunction = this.originalOverviewFunction;
			Workspace.Workspace.prototype._isOverviewWindow = function(win) {
				const originalResult = originalOverviewFunction(win);
				const metaWindow = win.get_meta_window();
				return originalResult && appWindows.indexOf(metaWindow) > -1;
			};

			// Only show application windows in thumbnails
			const originalThumbnailFunction = this.originalOverviewFunction;
			WorkspaceThumbnail.WorkspaceThumbnail.prototype._isOverviewWindow = function(win) {
				const originalResult = originalThumbnailFunction(win);
				const metaWindow = win.get_meta_window();
				return originalResult && appWindows.indexOf(metaWindow) > -1;
			};

			// If second last app window closed in app overview, activate remaining window (done in hidden event)
			this.destroyWindowId = global.window_manager.connect('destroy', Lang.bind(this, function (wm, windowActor) {
				const metaWindow = windowActor.get_meta_window();
				const index = appWindows.indexOf(metaWindow);
				if (index > -1) {
					appWindows.splice(index, 1);
				}
				if (appWindows.length === 1) {
					Main.overview.hide();
				}
			}));

			Main.overview.show();

			// Change hotcorner to show 'normal' overview, if in app overview
			const onOverviewHidden = this._onOverviewHidden.bind(this);
			Layout.HotCorner.prototype._toggleOverview = function() {
				if (this._monitor.inFullscreen)
					return;

				if (Main.overview.shouldToggleByCornerOrButton()) {
					this._rippleAnimation();
					onOverviewHidden();
					Main.overview._shown = false;
					Main.overview.visible = false;
					Main.layoutManager._inOverview = false;
					Main.overview.show();
				}
			};
			Main.layoutManager._updateHotCorners();
		}
	},

	_onOverviewHidden: function() {
		if (this.isInAppOverview) {
			this.isInAppOverview = false;
			// Restore original behaviour
			this.actor.disconnect(this.appIconScrollId);
			Layout.HotCorner.prototype._toggleOverview = this.originalHotCornerToggleFunction;
			Main.layoutManager._updateHotCorners();
			Main.overview._searchEntryBin.show();
			ViewSelector.ViewSelector.prototype._shouldTriggerSearch = this.originalTriggerSearchFunction;
			Workspace.Workspace.prototype._isOverviewWindow = this.originalOverviewFunction;
			WorkspaceThumbnail.WorkspaceThumbnail.prototype._isOverviewWindow = this.originalThumbnailFunction;
			global.window_manager.disconnect(this.destroyWindowId);
			// Check reason for leaving app overview was second last window closed
			if (this.appWindows.length === 1) {
				Main.activateWindow(this.appWindows[0]);
			}
		}
	},

	_onApplicationWorkspaceScroll: function(actor, event) {
		if (this.isInAppOverview) {
			let direction = AppIcons.unifyScrollDirection(event);
			let activeWs = global.screen.get_active_workspace();
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
	}
});

