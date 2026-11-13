import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BagSpecApp());
}

const _passwordKey = 'bagspec_password';

class BagSpecApp extends StatefulWidget {
  const BagSpecApp({super.key, this.storage = const FlutterSecureStorage(), this.apiFactory});

  final FlutterSecureStorage storage;
  final BagSpecApi Function(String password)? apiFactory;

  @override
  State<BagSpecApp> createState() => _BagSpecAppState();
}

class _BagSpecAppState extends State<BagSpecApp> {
  BagSpecApi? _api;
  bool _loading = true;

  BagSpecApi _make(String password) => widget.apiFactory?.call(password) ?? BagSpecApi(password: password);

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    String? saved;
    try {
      saved = await widget.storage.read(key: _passwordKey);
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _api = saved == null || saved.isEmpty ? null : _make(saved);
      _loading = false;
    });
  }

  Future<void> _signIn(String password) async {
    final api = _make(password);
    await api.checkLogin(); // throws on a wrong password
    await widget.storage.write(key: _passwordKey, value: password);
    if (mounted) setState(() => _api = api);
  }

  Future<void> _signOut() async {
    await widget.storage.delete(key: _passwordKey);
    if (mounted) setState(() => _api = null);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BagSpec',
      debugShowCheckedModeBanner: false,
      theme: bagSpecTheme(),
      home: _loading
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _api == null
              ? LoginScreen(onSignIn: _signIn)
              : HomeScreen(api: _api!, onSignOut: _signOut),
    );
  }
}
