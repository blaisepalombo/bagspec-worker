import 'dart:convert';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api.dart';
import '../models.dart';
import '../push.dart';
import '../theme.dart';

const _settingsKey = 'bagspec_alert_settings';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.api,
    required this.push,
    required this.onSignOut,
    this.storage = const FlutterSecureStorage(),
  });
  final BagSpecApi api;
  final PushBridge push;
  final Future<void> Function() onSignOut;
  final FlutterSecureStorage storage;

  @override
  State<SettingsScreen> createState() => SettingsScreenState();
}

class SettingsScreenState extends State<SettingsScreen> {
  AlertSettings _settings = const AlertSettings();
  String? _token;
  String _status = 'Checking notifications…';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      final saved = await widget.storage.read(key: _settingsKey);
      if (saved != null) _settings = AlertSettings.fromJson(jsonDecode(saved) as Map<String, dynamic>);
    } catch (_) {}
    await register();
  }

  /// Asks iOS for a push token and tells BagSpec where to send alerts.
  Future<void> register() async {
    if (kIsWeb) {
      setState(() => _status = 'Browser preview: push notifications only work in the iPhone app.');
      return;
    }
    setState(() => _busy = true);
    try {
      final token = await widget.push.requestToken();
      if (token == null) {
        setState(() => _status = 'Notifications are off. Turn them on in Settings › BagSpec › Notifications.');
        return;
      }
      _settings = await widget.api.registerDevice(
        token: token,
        sandbox: widget.push.sandbox,
        settings: _settings,
        deviceName: 'iPhone',
      );
      await widget.storage.write(key: _settingsKey, value: jsonEncode(_settings.toJson()));
      setState(() {
        _token = token;
        _status = 'This iPhone gets BagSpec alerts.';
      });
    } on ApiException catch (error) {
      setState(() => _status = 'Could not register for alerts: ${error.message}');
    } catch (error) {
      setState(() => _status = 'Could not turn on notifications: $error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _change(AlertSettings next) async {
    setState(() => _settings = next);
    await widget.storage.write(key: _settingsKey, value: jsonEncode(next.toJson()));
    if (_token != null) await register();
  }

  Future<void> _sendTest() async {
    final token = _token;
    if (token == null) return;
    setState(() => _busy = true);
    try {
      await widget.api.sendTestNotification(token);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Test sent. It should arrive in a few seconds.')));
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut() async {
    final token = _token;
    if (token != null) {
      try {
        await widget.api.unregisterDevice(token);
      } catch (_) {}
    }
    await widget.onSignOut();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Alerts')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          Text(_status, style: TextStyle(color: _token == null ? BagSpecColors.amber : BagSpecColors.muted)),
          const SizedBox(height: 12),
          Card(
            child: Column(children: [
              SwitchListTile(
                title: const Text('BUY deals'),
                subtitle: const Text('A deal passes every check'),
                value: _settings.buy,
                onChanged: _busy ? null : (v) => _change(_settings.copyWith(buy: v)),
              ),
              const Divider(height: 1),
              SwitchListTile(
                title: const Text('Auctions to bid on'),
                subtitle: const Text('Includes the most to bid'),
                value: _settings.auctions,
                onChanged: _busy ? null : (v) => _change(_settings.copyWith(auctions: v)),
              ),
              const Divider(height: 1),
              SwitchListTile(
                title: const Text('Daily digest'),
                subtitle: const Text('Top near-deals after 7 PM'),
                value: _settings.digest,
                onChanged: _busy ? null : (v) => _change(_settings.copyWith(digest: v)),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          if (_token == null)
            OutlinedButton(onPressed: _busy ? null : register, child: const Text('Turn on notifications'))
          else
            OutlinedButton(onPressed: _busy ? null : _sendTest, child: const Text('Send a test notification')),
          const SizedBox(height: 32),
          TextButton(onPressed: _signOut, child: const Text('Sign out', style: TextStyle(color: BagSpecColors.red))),
        ],
      ),
    );
  }
}
