import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// What a tapped notification points at.
class OpenedNotification {
  OpenedNotification({this.dealId, this.url});
  final int? dealId;
  final String? url;

  static OpenedNotification? fromMap(Object? value) {
    if (value is! Map) return null;
    final id = value['dealId'];
    return OpenedNotification(
      dealId: id is num ? id.toInt() : int.tryParse('${id ?? ''}'),
      url: value['url'] as String?,
    );
  }
}

/// Bridge to the native push code in ios/Runner/AppDelegate.swift.
class PushBridge {
  PushBridge._() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'opened') {
        final opened = OpenedNotification.fromMap(call.arguments);
        if (opened != null) _opened.add(opened);
      }
    });
  }
  static final PushBridge instance = PushBridge._();

  static const _channel = MethodChannel('bagspec/push');
  final _opened = StreamController<OpenedNotification>.broadcast();

  /// Taps on notifications while the app is running.
  Stream<OpenedNotification> get opened => _opened.stream;

  /// TestFlight and App Store builds use Apple's production push service.
  bool get sandbox => kDebugMode;

  /// Asks for permission and returns the APNs device token, or null when
  /// notifications are not allowed (or not on an iPhone).
  Future<String?> requestToken() async {
    try {
      return await _channel.invokeMethod<String>('requestToken');
    } on MissingPluginException {
      return null;
    }
  }

  /// The notification that launched the app, if any (asked for once).
  Future<OpenedNotification?> takeLaunchNotification() async {
    try {
      return OpenedNotification.fromMap(await _channel.invokeMethod('takeLaunchNotification'));
    } on MissingPluginException {
      return null;
    }
  }
}
