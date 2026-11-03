// Pair screen: ports ios/ContentView.swift:20-36 and the pair() gate at :78-94.
// Presentational only; all state lives in SessionProvider.

import React from "react";
import {
	Button,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";

import { PAIR_CODE_LENGTH } from "../session/validation.ts";

export type PairScreenProps = {
	host: string;
	code: string;
	error: string;
	busy: boolean;
	onChangeHost(host: string): void;
	onChangeCode(code: string): void;
	onPair(): void;
};

export function PairScreen(props: PairScreenProps): React.ReactElement {
	return (
		<View style={styles.container}>
			<Text style={styles.title}>Zot</Text>
			<Text style={styles.section}>Server</Text>
			<TextInput
				testID="pair-host"
				style={styles.input}
				value={props.host}
				onChangeText={props.onChangeHost}
				placeholder="Base URL"
				keyboardType="url"
				autoCapitalize="none"
				autoCorrect={false}
			/>
			<Text style={styles.section}>Pairing code</Text>
			<TextInput
				testID="pair-code"
				style={styles.input}
				value={props.code}
				onChangeText={props.onChangeCode}
				placeholder="6 digit code"
				keyboardType="number-pad"
				maxLength={PAIR_CODE_LENGTH}
				autoCorrect={false}
			/>
			<View style={styles.actions}>
				<Button
					testID="pair-submit"
					title="Pair"
					onPress={props.onPair}
					disabled={props.busy}
				/>
			</View>
			{props.error !== "" ? (
				<Text testID="pair-error" style={styles.error}>
					{props.error}
				</Text>
			) : null}
			<Text style={styles.footnote}>
				Ask the browser UI for the code. It expires in 5 minutes.
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, padding: 20, gap: 8 },
	title: { fontSize: 28, fontWeight: "600", marginBottom: 12 },
	section: { fontSize: 13, opacity: 0.6, marginTop: 8 },
	input: {
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#888",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 16,
	},
	actions: { marginTop: 12, alignItems: "flex-start" },
	error: { color: "#c62828", marginTop: 12 },
	footnote: { opacity: 0.6, marginTop: 12, fontSize: 13 },
});
